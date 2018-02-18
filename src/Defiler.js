import EventEmitter from 'events'
import { readFile } from './fs.js'

import File from './File.js'
import Waiter from './Waiter.js'
import Watcher from './Watcher.js'

export default class Defiler extends EventEmitter {
	constructor() {
		super()

		this._origFiles = new Map()
		this._files = new Map()
		this._ready = null

		this._waiter = new Waiter()

		this._watchers = []

		this._transforms = []
		this._filePromises = new Map()
		this._customGenerators = new Map()
		this._dependents = new Map()

		this._processing = false
		this._queue = []
	}

	// read-only getters

	get ready() {
		return this._ready
	}

	get origFiles() {
		return this._origFiles
	}

	get files() {
		return this._files
	}

	get origPaths() {
		return [...this._origFiles.keys()].sort()
	}

	// pre-exec (configuration) methods

	add(config) {
		this._checkBeforeExec('add')

		// add dir

		if (config.dir) {
			let { dir, read = true, watch = true, debounce = 50 } = config
			let watcher = new Watcher(dir, watch, debounce)
			this._watchers.push({ watcher, dir, read, watch })
		}

		// add transform

		if (config.transform) {
			let { transform, if: if_ } = config
			this._transforms.push({ transform, if: if_ })
		}

		// add generated file

		if (config.generator) {
			let { path, generator } = config
			this._customGenerators.set(path, generator)
		}

		return this
	}

	// exec

	exec() {
		this._checkBeforeExec('exec')
		this._processing = true
		this._ready = (async () => {
			await Promise.all(
				this._watchers.map(async ({ watcher, dir, read, watch }) => {
					if (watch) {
						watcher.on('', ({ event, path, stat }) => {
							this._enqueue({ event, dir, path, stat, read })
						})
					}
					for (let { path, stat } of await watcher.init()) {
						let promise = this._processPhysicalFile(dir, path, stat, read)
						this._waiter.add(promise)
						this._filePromises.set(path, promise)
						this._origFiles.set(path, null)
					}
				}),
			)

			for (let path of this._customGenerators.keys()) {
				let promise = this._handleGeneratedFile(path)
				this._waiter.add(promise)
				this._filePromises.set(path, promise)
			}

			await this._waiter.done

			let _processDependents = this._processDependents.bind(this)
			this.on('file', _processDependents)
			this.on('deleted', _processDependents)

			this._filePromises = null
			this._processing = false
		})()

		return this
	}

	// post-exec methods

	async get(path, dependent) {
		this._checkAfterExec('get')
		if (Array.isArray(path)) return Promise.all(path.map(path => this.get(path, dependent)))
		if (dependent) {
			if (this._dependents.has(dependent)) {
				this._dependents.get(dependent).add(path)
			} else {
				this._dependents.set(dependent, new Set([path]))
			}
		}
		if (this._filePromises) await this._filePromises.get(path)
		return this._files.get(path)
	}

	async refile(path) {
		this._checkAfterExec('refile')
		if (this._customGenerators.has(path)) {
			await this._handleGeneratedFile(path)
		} else if (this._origFiles.has(path)) {
			await this._processFile(this._origFiles.get(path))
		}
	}

	async addFile(file) {
		this._checkAfterExec('addFile')
		let { path } = file
		if (!(file instanceof File)) file = Object.assign(new File(), file)
		await this._waiter.add(this._transformFile(file))
		this._files.set(path, file)
		this.emit('file', { defiler: this, path, file })
	}

	// private methods

	_checkBeforeExec(methodName) {
		if (this._ready) throw new Error(`Cannot call ${methodName} after calling exec`)
	}

	_checkAfterExec(methodName) {
		if (!this._ready) throw new Error(`Cannot call ${methodName} before calling exec`)
	}

	async _enqueue(event) {
		this._queue.push(event)
		if (this._processing) return
		this._processing = true
		while (this._queue.length) {
			let { event, dir, path, stat, read } = this._queue.shift()
			if (event === '+') {
				await this._processPhysicalFile(dir, path, stat, read)
			} else if (event === '-') {
				this._origFiles.delete(path)
				this._files.delete(path)
				this.emit('deleted', { defiler: this, path })
			}
		}
		this._processing = false
	}

	async _processPhysicalFile(dir, path, fileStat, read) {
		let origFile = new File(path)
		origFile.stat = fileStat
		if (read) origFile.bytes = await readFile(dir + '/' + path)
		this._origFiles.set(path, origFile)
		this.emit('origFile', { defiler: this, file: origFile })
		await this._processFile(origFile)
	}

	async _processFile(origFile) {
		let file = Object.assign(new File(), origFile)
		await this._transformFile(file)
		this._files.set(origFile.path, file)
		this.emit('file', { defiler: this, path: origFile.path, file })
	}

	async _transformFile(file) {
		let { path } = file
		try {
			for (let { transform, if: if_ } of this._transforms) {
				if (!if_ || (await if_({ defiler: this, path, file }))) {
					await transform({
						defiler: this,
						path,
						file,
						get: dependency => this.get(dependency, path),
					})
				}
			}
		} catch (error) {
			this.emit('error', { defiler: this, path, file, error })
		}
	}

	async _handleGeneratedFile(path) {
		let file
		try {
			file = new File(path)
			await this._customGenerators.get(path)({
				defiler: this,
				file,
				get: dependency => this.get(dependency, path),
			})
			await this.addFile(file)
		} catch (error) {
			this.emit('error', { defiler: this, path, file, error })
		}
	}

	_processDependents({ path }) {
		let dependents = new Set()
		for (let [dependent, dependencies] of this._dependents.entries()) {
			if (dependencies.has(path)) {
				dependents.add(dependent)
				this._dependents.delete(dependent)
			}
		}
		for (let dependent of dependents) this.refile(dependent)
	}
}
