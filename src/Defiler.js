import EventEmitter from 'events'
import { readFile } from './fs.js'
import { resolve } from 'path'

import File from './File.js'
import Waiter from './Waiter.js'
import Watcher from './Watcher.js'

import symbols from './symbols.js'
let {
	_origFiles,
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
			!Array.isArray(generators) ||
			generators.some(generator => typeof generator !== 'function')
		) {
			throw new TypeError('defiler: generators must be an array of functions')
		}
		super()
		dir = resolve(dir)
		Object.assign(this, {
			paths: new Set(), // set of original paths for all physical files
			[_origFiles]: new Map(), // original paths -> original file data for all physical files
			files: new Map(), // original paths -> transformed files for all physical and virtual files
			[_status]: null, // null = exec not called; false = exec pending; true = exec finished
			[_dir]: { watcher: new Watcher(dir, watch, debounce), dir, read, enc, watch }, // information about the directory to watch
			[_transform]: transform, // the transform to run on all files
			[_generators]: new Map(generators.map(generator => [Symbol(), generator])), // unique symbols -> registered generators
			[_waiter]: new Waiter(), // Waiter instance, to help wait for all promises in the current wave to resolve
			[_pending]: new Set(), // original paths of all files currently undergoing transformation and symbols of all generators running
			[_waiting]: new Map(), // original paths -> number of other files they're currently waiting on to exist
			[_available]: new Map(), // original paths -> { promise, resolve } objects for when awaited files become available
			[_dependents]: new Map(), // original paths of dependents -> set of original paths of dependencies, specifying changes to which files should trigger re-processing which other files
			[_queue]: [], // queue of pending Watcher events to handle
			[_processing]: false, // whether some Watcher event is currently already in the process of being handled
		})
	}

	// exec

	async exec() {
		if (this[_status] !== null) throw new Error('defiler.exec: cannot call more than once')
		this[_status] = false
		this[_processing] = true
		let done = this[_waiter].init()
		// init the Watcher instance
		let { watcher, watch } = this[_dir]
		if (watch) watcher.on('', event => this[_enqueue](event))
		let files = await watcher.init()
		// note that all files are pending transformation
		for (let { path } of files) {
			this.paths.add(path)
			this[_pending].add(path)
		}
		for (let symbol of this[_generators].keys()) this[_pending].add(symbol)
		// process each physical file
		for (let { path, stats } of files) this[_waiter].add(this[_processPhysicalFile](path, stats))
		// process each generator
		for (let symbol of this[_generators].keys()) this[_waiter].add(this[_processGenerator](symbol))
		// wait and finish up
		await done
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
		this.files.set(path, file)
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
			let { event, path, stats } = this[_queue].shift()
			if (event === '+') {
				let done = this[_waiter].init()
				this[_waiter].add(this[_processPhysicalFile](path, stats))
				await done
			} else if (event === '-') {
				let file = this.files.get(path)
				this.paths.delete(path)
				this[_origFiles].delete(path)
				this.files.delete(path)
				this.emit('deleted', { defiler: this, file })
				this[_processDependents](path)
			}
		}
		this[_processing] = false
	}

	// create a file object for a physical file and process it
	async [_processPhysicalFile](path, stats) {
		let { dir, read, enc } = this[_dir]
		let data = { path, stats, enc }
		if (read) data.bytes = await readFile(dir + '/' + path)
		this.paths.add(path)
		this[_origFiles].set(path, data)
		this.emit('read', { defiler: this, file: Object.assign(new File(), data) })
		await this[_processFile](data)
	}

	// transform a file, store it, and process dependents
	async [_processFile](data) {
		let file = Object.assign(new File(), data)
		await this[_transformFile](file)
		this.files.set(data.path, file)
		this.emit('file', { defiler: this, file })
		this[_found](data.path)
		this[_processDependents](data.path)
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
		if (!this[_status] && !this.files.has(path)) {
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
		return this.files.get(path)
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
