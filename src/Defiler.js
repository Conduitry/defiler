import EventEmitter from 'events'
import { readFile } from './fs.js'
import { resolve } from 'path'

import File from './File.js'
import Watcher from './Watcher.js'

export default class Defiler extends EventEmitter {
	constructor() {
		super()
		// original paths -> original files for all physical files
		this._origFiles = new Map()
		// original paths -> transformed files for all physical/generated/etc. files
		this._files = new Map()
		// null = exec not called; false = exec pending; true = exec finished
		this._status = null
		// all registered watchers (one per directory)
		this._watchers = []
		// all registered transforms
		this._transforms = []
		// paths -> registered generators
		this._generators = new Map()
		// how many promises we're currently waiting to resolve as part of the first exec wave
		this._count = 0
		// resolve main exec promise
		this._res = null
		// reject main exec promise
		this._rej = null
		// original paths of all files currently undergoing some transform
		this._transforming = new Set()
		// original paths -> number of other files they're currently waiting on to exist
		this._waiting = new Map()
		// original paths -> { promise, resolve } objects for when awaited files become available
		this._available = new Map()
		// original paths of dependents -> set of original paths of dependencies, specifying changes to which files should trigger re-processing which other files
		this._dependents = new Map()
		// queue of pending watcher events to handle
		this._queue = []
		// where some watcher event is currently already in the process of being handled
		this._processing = false
	}

	// read-only getters

	get status() {
		return this._status
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

	// register one or more directories/watchers
	dir(...dirs) {
		this._checkBeforeExec('dir')
		for (let { dir, read = true, watch = true, debounce = 10 } of dirs.filter(Boolean)) {
			dir = resolve(dir).replace(/\\/g, '/')
			let watcher = new Watcher(dir, watch, debounce)
			this._watchers.push({ watcher, dir, read, watch })
		}
		return this
	}

	// register one or more transforms
	transform(...transforms) {
		this._checkBeforeExec('transform')
		this._transforms.push(...transforms.filter(Boolean))
		return this
	}

	// register one or more generators
	generator(generators) {
		this._checkBeforeExec('generator')
		for (let [path, generator] of Object.entries(generators)) {
			if (path && generator) this._generators.set(path, generator)
		}
		return this
	}

	// exec

	async exec() {
		this._checkBeforeExec('exec')
		this._status = false
		this._processing = true
		let promise = new Promise((res, rej) => {
			this._res = res
			this._rej = rej
		})
		// init all watchers; note that all files have pending transforms
		let files = []
		await Promise.all(
			this._watchers.map(async ({ watcher, dir, read, watch }) => {
				if (watch) {
					watcher.on('', ({ event, path, stat }) => this._enqueue({ event, dir, path, stat, read }))
				}
				for (let { path, stat } of await watcher.init()) {
					files.push({ dir, path, stat, read })
					this._origFiles.set(path, null)
					this._transforming.add(path)
				}
			}),
		)
		for (let path of this._generators.keys()) this._transforming.add(path)
		// process each physical file
		for (let { dir, path, stat, read } of files) {
			this._wait(this._processPhysicalFile(dir, path, stat, read))
		}
		// process each generated file
		for (let path of this._generators.keys()) this._wait(this._handleGeneratedFile(path))
		// wait and finish up
		await promise
		this._status = true
		this._processing = false
	}

	// post-exec methods

	// wait for a file to be available, optionally marking another file as depending on it
	async get(path, dependent) {
		this._checkAfterExec('get')
		if (Array.isArray(path)) return Promise.all(path.map(path => this.get(path, dependent)))
		if (dependent) this.depend(dependent, path)
		if (!this._status && !this._files.has(path) && dependent) {
			this._waiting.set(dependent, (this._waiting.get(dependent) || 0) + 1)
			if (this._available.has(path)) {
				await this._available.get(path).promise
			} else {
				let resolve
				let promise = new Promise(res => (resolve = res))
				this._available.set(path, { promise, resolve })
				await promise
			}
			this._waiting.set(dependent, this._waiting.get(dependent) - 1)
		}
		return this._files.get(path)
	}

	// add a new non-physical file
	async file(file) {
		this._checkAfterExec('file')
		let { path } = file
		if (!(file instanceof File)) file = Object.assign(new File(), file)
		await this._wait(this._transformFile(file))
		this._files.set(path, file)
		this.emit('file', { defiler: this, path, file })
		this._found(path)
		this._processDependents(path)
	}

	// mark dependence of one file on another
	depend(dependent, path) {
		this._checkAfterExec('depend')
		if (this._dependents.has(dependent)) {
			this._dependents.get(dependent).add(path)
		} else {
			this._dependents.set(dependent, new Set([path]))
		}
	}

	// private methods

	_checkBeforeExec(methodName) {
		if (this._status !== null) throw new Error(`Cannot call ${methodName} after calling exec`)
	}

	_checkAfterExec(methodName) {
		if (this._status === null) throw new Error(`Cannot call ${methodName} before calling exec`)
	}

	// add another promise that must resolve before the initial exec wave can finish
	_wait(promise) {
		if (!this._status) {
			this._count++
			promise.then(() => --this._count || this._res(), this._rej)
		}
		return promise
	}

	// add a watcher event from the queue, and handle queued events
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
				this._processDependents(path)
			}
		}
		this._processing = false
	}

	// create a file object for a physical file and process it
	async _processPhysicalFile(dir, path, stat, read) {
		let origFile = new File(path)
		origFile.stat = stat
		if (read) origFile.bytes = await readFile(dir + '/' + path)
		this._origFiles.set(path, origFile)
		this.emit('origFile', { defiler: this, file: origFile })
		await this._processFile(origFile)
	}

	// transform a file, store it, and process dependents
	async _processFile(origFile) {
		let file = Object.assign(new File(), origFile)
		await this._transformFile(file)
		this._files.set(origFile.path, file)
		this.emit('file', { defiler: this, path: origFile.path, file })
		this._found(origFile.path)
		this._processDependents(origFile.path)
	}

	// perform all transforms on a file
	async _transformFile(file) {
		let { path } = file
		this._transforming.add(path)
		try {
			for (let transform of this._transforms) {
				await transform({
					defiler: this,
					path,
					file,
					get: dependency => this.get(dependency, path),
				})
			}
		} catch (error) {
			this.emit('error', { defiler: this, path, file, error })
		}
		this._transforming.delete(path)
		if (!this._status && [...this._transforming].every(path => this._waiting.get(path))) {
			// all pending transforming files are currently waiting for one or more other files to exist
			// break deadlock: assume all files that have not appeared yet will never do so
			for (let path of this._available.keys()) if (!this._transforming.has(path)) this._found(path)
		}
	}

	// run a generator and transform and add the file
	async _handleGeneratedFile(path) {
		let file
		try {
			file = new File(path)
			await this._generators.get(path)({
				defiler: this,
				file,
				get: dependency => this.get(dependency, path),
			})
			await this.file(file)
		} catch (error) {
			this.emit('error', { defiler: this, path, file, error })
		}
	}

	// re-process all files that depend on a particular path
	_processDependents(path) {
		if (!this._status) return
		let dependents = new Set()
		for (let [dependent, dependencies] of this._dependents.entries()) {
			if (dependencies.has(path)) {
				dependents.add(dependent)
				this._dependents.delete(dependent)
			}
		}
		for (let dependent of dependents) {
			if (this._generators.has(dependent)) {
				this._handleGeneratedFile(dependent)
			} else if (this._origFiles.has(dependent)) {
				this._processFile(this._origFiles.get(dependent))
			}
		}
	}

	// mark a given awaited file as being found
	_found(path) {
		if (!this._status && this._available.has(path)) {
			this._available.get(path).resolve()
			this._available.delete(path)
		}
	}
}
