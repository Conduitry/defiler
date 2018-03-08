import EventEmitter from 'events'
import { readFile } from './fs.js'
import { resolve } from 'path'

import File from './File.js'
import Waiter from './Waiter.js'
import Watcher from './Watcher.js'

import symbols from './symbols.js'
let {
	_paths,
	_origFiles,
	_files,
	_status,
	_dir,
	_transform,
	_generators,
	_waiter,
	_pending,
	_waiting,
	_available,
	_dependents,
	_queue,
	_processing,
	_enqueue,
	_processPhysicalFile,
	_processFile,
	_transformFile,
	_processGenerator,
	_get,
	_processDependents,
	_found,
} = symbols

export default class Defiler extends EventEmitter {
	constructor({
		dir,
		read = true,
		enc = 'utf8',
		watch = true,
		debounce = 10,
		transform,
		generators = [],
	}) {
		if (typeof dir !== 'string') throw new TypeError('defiler: dir must be a string')
		if (typeof read !== 'boolean') throw new TypeError('defiler: read must be a boolean')
		if (!Buffer.isEncoding(enc)) throw new TypeError('defiler: enc must be a supported encoding')
		if (typeof watch !== 'boolean') throw new TypeError('defiler: watch must be a boolean')
		if (typeof debounce !== 'number') throw new TypeError('defiler: debounce must be a number')
		if (typeof transform !== 'function') {
			throw new TypeError('defiler: transform must be a function')
		}
		if (
			!generators[Symbol.iterator] ||
			[...generators].some(generator => typeof generator !== 'function')
		) {
			throw new TypeError('defiler: generators must be a collection of functions')
		}
		super()
		// set of original paths for all physical files
		this[_paths] = new Set()
		// original paths -> original files for all physical files
		this[_origFiles] = new Map()
		// original paths -> transformed files for all physical and virtual files
		this[_files] = new Map()
		// null = exec not called; false = exec pending; true = exec finished
		this[_status] = null
		// information about the directory to watch
		dir = resolve(dir)
		this[_dir] = { watcher: new Watcher(dir, watch, debounce), dir, read, enc, watch }
		// the transform to run on all files
		this[_transform] = transform
		// unique symbols -> registered generators
		this[_generators] = new Map()
		for (let generator of generators) this[_generators].set(Symbol(), generator)
		// Waiter instance, to help wait for all promises in the current wave to resolve
		this[_waiter] = new Waiter()
		// original paths of all files currently undergoing transformation and symbols of all generators running
		this[_pending] = new Set()
		// original paths -> number of other files they're currently waiting on to exist
		this[_waiting] = new Map()
		// original paths -> { promise, resolve } objects for when awaited files become available
		this[_available] = new Map()
		// original paths of dependents -> set of original paths of dependencies, specifying changes to which files should trigger re-processing which other files
		this[_dependents] = new Map()
		// queue of pending Watcher events to handle
		this[_queue] = []
		// whether some Watcher event is currently already in the process of being handled
		this[_processing] = false
	}

	// read-only getters

	get files() {
		if (this[_status] === null) throw new Error('defiler.files: cannot access before calling exec')
		return this[_files]
	}

	get paths() {
		if (this[_status] === null) throw new Error('defiler.paths: cannot access before calling exec')
		return this[_paths]
	}

	// exec

	async exec() {
		if (this[_status] !== null) throw new Error('defiler.exec: cannot call more than once')
		this[_status] = false
		this[_processing] = true
		this[_waiter].init()
		// init the Watcher instance
		let { watcher, watch } = this[_dir]
		if (watch) watcher.on('', event => this[_enqueue](event))
		let files = await watcher.init()
		// note that all files are pending transformation
		for (let { path } of files) {
			this[_paths].add(path)
			this[_pending].add(path)
		}
		for (let symbol of this[_generators].keys()) this[_pending].add(symbol)
		// process each physical file
		for (let { path, stat } of files) this[_waiter].add(this[_processPhysicalFile](path, stat))
		// process each generator
		for (let symbol of this[_generators].keys()) this[_waiter].add(this[_processGenerator](symbol))
		// wait and finish up
		await this[_waiter].promise
		this[_status] = true
		this[_processing] = false
	}

	// post-exec methods

	// add a new non-physical file
	async add(file) {
		if (this[_status] === null) throw new Error('defiler.add: cannot call before calling exec')
		if (typeof file !== 'object') throw new TypeError('defiler.add: file must be an object')
		let { path } = file
		if (!(file instanceof File)) file = Object.assign(new File(), file)
		await this[_waiter].add(this[_transformFile](file))
		this[_files].set(path, file)
		this.emit('file', { defiler: this, file })
		this[_found](path)
		this[_processDependents](path)
	}

	// mark dependence of one file on another
	depend(dependent, path) {
		if (this[_status] === null) throw new Error('defiler.depend: cannot call before calling exec')
		if (typeof dependent !== 'string' && !this[_generators].has(dependent)) {
			throw new TypeError('defiler.depend: dependent must be a string')
		}
		if (typeof path !== 'string') throw new TypeError('defiler.depend: path must be a string')
		if (this[_dependents].has(dependent)) {
			this[_dependents].get(dependent).add(path)
		} else {
			this[_dependents].set(dependent, new Set([path]))
		}
	}

	// private methods

	// add a Watcher event to the queue, and handle queued events
	async [_enqueue](event) {
		this[_queue].push(event)
		if (this[_processing]) return
		this[_processing] = true
		while (this[_queue].length) {
			let { event, path, stat } = this[_queue].shift()
			if (event === '+') {
				this[_waiter].init()
				this[_waiter].add(this[_processPhysicalFile](path, stat))
				await this[_waiter].promise
			} else if (event === '-') {
				let file = this[_files].get(path)
				this[_paths].delete(path)
				this[_origFiles].delete(path)
				this[_files].delete(path)
				this.emit('deleted', { defiler: this, file })
				this[_processDependents](path)
			}
		}
		this[_processing] = false
	}

	// create a file object for a physical file and process it
	async [_processPhysicalFile](path, stat) {
		let { dir, read, enc } = this[_dir]
		let file = Object.assign(new File(), { path, stat, enc })
		if (read) file.bytes = await readFile(dir + '/' + path)
		this[_paths].add(path)
		this[_origFiles].set(path, file)
		this.emit('read', { defiler: this, file })
		await this[_processFile](file)
	}

	// transform a file, store it, and process dependents
	async [_processFile](origFile) {
		let file = Object.assign(new File(), origFile)
		await this[_transformFile](file)
		this[_files].set(origFile.path, file)
		this.emit('file', { defiler: this, file })
		this[_found](origFile.path)
		this[_processDependents](origFile.path)
	}

	// transform a file
	async [_transformFile](file) {
		let { path } = file
		this[_pending].add(path)
		try {
			await this[_transform]({
				defiler: this,
				file,
				get: dependency => this[_get](path, dependency),
			})
		} catch (error) {
			this.emit('error', { defiler: this, file, error })
		}
		this[_pending].delete(path)
		if (!this[_status] && [...this[_pending]].every(path => this[_waiting].get(path))) {
			// all pending files are currently waiting for one or more other files to exist
			// break deadlock: assume all files that have not appeared yet will never do so
			for (let path of this[_available].keys()) if (!this[_pending].has(path)) this[_found](path)
		}
	}

	// run the generator given by the symbol
	async [_processGenerator](symbol) {
		this[_pending].add(symbol)
		let generator = this[_generators].get(symbol)
		try {
			await generator({ defiler: this, get: dependency => this[_get](symbol, dependency) })
		} catch (error) {
			this.emit('error', { defiler: this, generator, error })
		}
		this[_pending].delete(symbol)
	}

	// wait for a file to be available and mark another file as depending on it
	async [_get](dependent, path) {
		if (Array.isArray(path)) return Promise.all(path.map(path => this[_get](dependent, path)))
		this.depend(dependent, path)
		if (!this[_status] && !this[_files].has(path)) {
			this[_waiting].set(dependent, (this[_waiting].get(dependent) || 0) + 1)
			if (this[_available].has(path)) {
				await this[_available].get(path).promise
			} else {
				let resolve
				let promise = new Promise(res => (resolve = res))
				this[_available].set(path, { promise, resolve })
				await promise
			}
			this[_waiting].set(dependent, this[_waiting].get(dependent) - 1)
		}
		return this[_files].get(path)
	}

	// re-process all files that depend on a particular path
	[_processDependents](path) {
		if (!this[_status]) return
		let dependents = new Set()
		for (let [dependent, dependencies] of this[_dependents].entries()) {
			if (dependencies.has(path)) {
				dependents.add(dependent)
				this[_dependents].delete(dependent)
			}
		}
		for (let dependent of dependents) {
			if (this[_origFiles].has(dependent)) {
				this[_processFile](this[_origFiles].get(dependent))
			} else if (this[_generators].has(dependent)) {
				this[_processGenerator](dependent)
			}
		}
	}

	// mark a given awaited file as being found
	[_found](path) {
		if (!this[_status] && this[_available].has(path)) {
			this[_available].get(path).resolve()
			this[_available].delete(path)
		}
	}
}
