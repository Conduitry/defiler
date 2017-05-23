import EventEmitter from 'events'
import { readFile, stat } from 'fs'
import { relative } from 'path'

import File from './File.js'

export default class Defiler extends EventEmitter {
	constructor() {
		super()

		this._origFiles = new Map()
		this._files = new Map()
		this._ready = null

		this._gazes = []
		this._gazePromises = []

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

		// add gaze

		if (config.gaze) {
			let { gaze, rootPath, read = true } = config
			this._gazes.push({ gaze, rootPath, read })
			this._gazePromises.push(new Promise(res => gaze.on('ready', res)))
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
		this._ready = new Promise(async res => {
			await Promise.all(this._gazePromises)
			this._gazePromises = null

			let promises = []

			for (let { gaze, rootPath, read } of this._gazes) {
				let watched = gaze.watched()
				for (let dir in watched) {
					for (let absolutePath of watched[dir]) {
						let promise = this._processPhysicalFile(absolutePath, rootPath, read)
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

			for (let { gaze, rootPath, read } of this._gazes) {
				gaze.on('all', (event, absolutePath) => {
					this._queue.push({ event, absolutePath, rootPath, read })
					this._checkQueue()
				})
			}

			await Promise.all(promises)

			let _processDependents = this._processDependents.bind(this)
			this.on('file', _processDependents)
			this.on('deleted', _processDependents)

			this._filePromises = null
			this._processing = false
			res()
		})

		return this
	}

	// post-exec methods

	async use(path, { from } = {}) {
		this._checkAfterExec('use')
		if (Array.isArray(path)) {
			return Promise.all(path.map(path => this.use(path, { from })))
		}
		if (from) {
			if (this._dependents.has(from)) {
				this._dependents.get(from).add(path)
			} else {
				this._dependents.set(from, new Set([path]))
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
		await this._transformFile(file)
		this._files.set(path, file)
		this.emit('file', path, file)
	}

	close() {
		this._checkAfterExec('close')
		for (let { gaze } of this._gazes) {
			gaze.close()
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
			if (event === 'deleted') {
				let path = Defiler._relativePath(rootPath, absolutePath)
				this._origFiles.delete(path)
				this._files.delete(path)
				this.emit('deleted', path)
			} else {
				await this._processPhysicalFile(absolutePath, rootPath, read)
			}
		}
		this._processing = false
	}

	async _processPhysicalFile(absolutePath, rootPath, read) {
		let fileStat = await new Promise((res, rej) => stat(absolutePath, (err, data) => (err ? rej(err) : res(data))))
		if (!fileStat.isFile()) {
			return
		}
		let path = Defiler._relativePath(rootPath, absolutePath)
		let origFile = new File(path)
		origFile.stat = fileStat
		if (read) {
			origFile.bytes = await new Promise((res, rej) => readFile(absolutePath, (err, data) => (err ? rej(err) : res(data))))
		}
		this._origFiles.set(path, origFile)
		this.emit('origFile', path, origFile)
		await this._processFile(origFile)
	}

	async _processFile(origFile) {
		let file = Object.assign(new File(), origFile)
		await this._transformFile(file)
		this._files.set(origFile.path, file)
		this.emit('file', origFile.path, file)
	}

	async _transformFile(file) {
		let { path } = file
		try {
			for (let { transform, if: if_ } of this._transforms) {
				if (!if_ || (await if_.call(this, file))) {
					await transform.call(this, file)
				}
			}
		} catch (err) {
			this.emit('error', path, file, err)
		}
	}

	async _handleGeneratedFile(path) {
		let file
		try {
			file = new File(path)
			await this._customGenerators.get(path).call(this, file)
			await this.addFile(file)
		} catch (err) {
			this.emit('error', path, file, err)
		}
	}

	_processDependents(origPath) {
		let dependents = new Set()
		for (let [dependent, dependencies] of this._dependents.entries()) {
			if (dependencies.has(origPath)) {
				dependents.add(dependent)
				this._dependents.delete(dependent)
			}
		}
		for (let dependent of dependents) {
			this.refile(dependent)
		}
	}

	static _relativePath(rootPath, absolutePath) {
		return relative(rootPath, absolutePath).replace(/\\/g, '/')
	}
}
