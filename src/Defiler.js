import EventEmitter from 'events'
import { readFile, stat } from 'fs'
import { join, relative } from 'path'

import File from './File.js'

export default class Defiler extends EventEmitter {
	constructor() {
		super()

		this._origFiles = new Map()
		this._files = new Map()
		this._ready = null

		this._chokidars = []
		this._chokidarPromises = []

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

		// add chokidar

		if (config.chokidar) {
			let { chokidar, rootPath, read = true } = config
			this._chokidars.push({ chokidar, rootPath, read })
			this._chokidarPromises.push(new Promise(res => chokidar.on('ready', res)))
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

	exec({ close = false } = {}) {
		this._checkBeforeExec('exec')
		this._processing = true
		this._ready = (async () => {
			await Promise.all(this._chokidarPromises)
			this._chokidarPromises = null

			let promises = []

			for (let { chokidar, rootPath, read } of this._chokidars) {
				let watched = chokidar.getWatched()
				for (let dir in watched) {
					for (let name of watched[dir]) {
						let absolutePath = join(dir, name)
						if (watched[absolutePath]) {
							continue
						}

						let promise = this._processPhysicalFile(
							absolutePath,
							rootPath,
							read
						)
						promises.push(promise)
						let path = Defiler._relativePath(rootPath, absolutePath)
						this._filePromises.set(path, promise)
						this._origFiles.set(path, null)
					}
				}
			}

			for (let path of this._customGenerators.keys()) {
				let promise = this._handleGeneratedFile(path)
				promises.push(promise)
				this._filePromises.set(path, promise)
			}

			if (close) {
				this.close()
			} else {
				for (let { chokidar, rootPath, read } of this._chokidars) {
					chokidar.on('all', (event, absolutePath) => {
						this._queue.push({ event, absolutePath, rootPath, read })
						this._checkQueue()
					})
				}
			}

			await Promise.all(promises)

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
		if (Array.isArray(path)) {
			return Promise.all(path.map(path => this.get(path, dependent)))
		}
		if (dependent) {
			if (this._dependents.has(dependent)) {
				this._dependents.get(dependent).add(path)
			} else {
				this._dependents.set(dependent, new Set([path]))
			}
		}
		if (this._filePromises) {
			await this._filePromises.get(path)
		}
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
		if (!(file instanceof File)) {
			file = Object.assign(new File(), file)
		}
		await this._transformFile(file)
		this._files.set(path, file)
		this.emit('file', { defiler: this, path, file })
	}

	close() {
		this._checkAfterExec('close')
		for (let { chokidar } of this._chokidars) {
			chokidar.close()
		}
	}

	// private methods

	_checkBeforeExec(methodName) {
		if (this._ready) {
			throw new Error(`Cannot call ${methodName} after calling exec`)
		}
	}

	_checkAfterExec(methodName) {
		if (!this._ready) {
			throw new Error(`Cannot call ${methodName} before calling exec`)
		}
	}

	async _checkQueue() {
		if (this._processing) {
			return
		}
		this._processing = true
		while (this._queue.length) {
			let { event, absolutePath, rootPath, read } = this._queue.shift()
			if (event === 'add' || event === 'change') {
				await this._processPhysicalFile(absolutePath, rootPath, read)
			} else if (event === 'unlink') {
				let path = Defiler._relativePath(rootPath, absolutePath)
				this._origFiles.delete(path)
				this._files.delete(path)
				this.emit('deleted', { defiler: this, path })
			}
		}
		this._processing = false
	}

	async _processPhysicalFile(absolutePath, rootPath, read) {
		let fileStat = await new Promise((res, rej) =>
			stat(absolutePath, (err, data) => (err ? rej(err) : res(data)))
		)
		if (!fileStat.isFile()) {
			return
		}
		let path = Defiler._relativePath(rootPath, absolutePath)
		let origFile = new File(path)
		origFile.stat = fileStat
		if (read) {
			origFile.bytes = await new Promise((res, rej) =>
				readFile(absolutePath, (err, data) => (err ? rej(err) : res(data)))
			)
		}
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
		for (let dependent of dependents) {
			this.refile(dependent)
		}
	}

	static _relativePath(rootPath, absolutePath) {
		return (rootPath ? relative(rootPath, absolutePath) : absolutePath).replace(
			/\\/g,
			'/'
		)
	}
}
