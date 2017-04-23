import EventEmitter from 'events'
import { readFile, stat } from 'fs'
import { relative } from 'path'

import File from './File.js'

let TRANSFORM = Symbol()
let IF = Symbol()
let ELSE = Symbol()
let END = Symbol()

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
		this._dependencies = new Map()
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
		return [...(this._filePromises || this._origFiles).keys()].sort()
	}

	// pre-exec (configuration) methods

	addGaze(gaze, rootPath, read = true) {
		this._checkBeforeExec('addGaze')
		this._gazes.push({ gaze, rootPath, read })
		this._gazePromises.push(new Promise(res => gaze.on('ready', res)))
		return this
	}

	addTransform(transform) {
		this._checkBeforeExec('addTransform')
		this._transforms.push({ type: TRANSFORM, transform })
		return this
	}

	if(condition) {
		this._checkBeforeExec('if')
		this._transforms.push({ type: IF, condition })
		return this
	}

	else() {
		this._checkBeforeExec('else')
		this._transforms.push({ type: ELSE })
		return this
	}

	end() {
		this._checkBeforeExec('end')
		this._transforms.push({ type: END })
		return this
	}

	addGeneratedFile(path, generator) {
		this._checkBeforeExec('addGeneratedFile')
		this._customGenerators.set(path, generator)
		return this
	}

	// exec

	exec() {
		this._checkBeforeExec('exec')
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
						this._filePromises.set(Defiler._relativePath(rootPath, absolutePath), promise)
					}
				}
			}

			for (let path of this._customGenerators.keys()) {
				let promise = this._handleGeneratedFile(path)
				promises.push(promise)
				this._filePromises.set(path, promise)
			}

			await Promise.all(promises)

			for (let { gaze, rootPath, read } of this._gazes) {
				gaze.on('all', (event, absolutePath) => {
					if (event === 'deleted') {
						let path = Defiler._relativePath(rootPath, absolutePath)
						this._origFiles.delete(path)
						this._files.delete(path)
						this.emit('deleted', path)
					} else {
						this._processPhysicalFile(absolutePath, rootPath, read)
					}
				})
			}

			this.on('file', file => {
				let origins = new Set()
				for (let [origin, deps] of this._dependencies.entries()) {
					if (deps.has(file.path)) {
						origins.add(origin)
						this._dependencies.delete(origin)
					}
				}
				for (let originPath of origins) {
					this.refile(originPath)
				}
			})

			this._filePromises = null
			res()
		})

		return this
	}

	// post-exec methods

	async use(path, origin) {
		this._checkAfterExec('use')
		if (Array.isArray(path)) {
			return Promise.all(path.map(path => this.use(path, origin)))
		}
		if (origin) {
			if (this._dependencies.has(origin)) {
				this._dependencies.get(origin).add(path)
			} else {
				this._dependencies.set(origin, new Set([path]))
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
		this.emit('file', file)
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
		this.emit('origFile', origFile)
		await this._processFile(origFile)
	}

	async _processFile(origFile) {
		let file = new File(origFile.path)
		file.stat = origFile.stat
		file.bytes = origFile.bytes
		await this._transformFile(file)
		this._files.set(origFile.path, file)
		this.emit('file', file)
	}

	async _transformFile(file) {
		let depth = 0
		let skipDepth = null
		try {
			for (let { type, transform, condition } of this._transforms) {
				if (type === TRANSFORM) {
					if (skipDepth === null) {
						await transform.call(this, file)
					}
				} else if (type === IF) {
					if (skipDepth === null && !condition.call(this, file)) {
						skipDepth = depth
					}
					depth++
				} else if (type === ELSE) {
					if (skipDepth === null) {
						skipDepth = depth - 1
					} else if (skipDepth === depth - 1) {
						skipDepth = null
					}
				} else if (type === END) {
					depth--
					if (skipDepth === depth) {
						skipDepth = null
					}
				}
			}
		} catch (err) {
			this.emit('error', file, err)
		}
	}

	async _handleGeneratedFile(path) {
		try {
			let file = new File(path)
			await this._customGenerators.get(path).call(this, file)
			await this.addFile(file)
		} catch (err) {
			this.emit('error', path, err)
		}
	}

	static _relativePath(rootPath, absolutePath) {
		return relative(rootPath, absolutePath).replace(/\\/g, '/')
	}
}
