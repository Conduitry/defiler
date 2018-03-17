import EventEmitter from 'events'
import { readFile } from './fs.js'
import { resolve } from 'path'

import File from './File.js'
import Watcher from './Watcher.js'

import symbols from './symbols.js'
// prettier-ignore
let { _origData, _status, _watcher, _transform, _generators, _resolver, _active, _waitingFor, _whenFound, _deps, _queue, _isProcessing, _startWave, _endWave, _enqueue, _processPhysicalFile, _processFile, _processGenerator, _cur, _newProxy, _processDependents, _markFound } = symbols

export default class Defiler extends EventEmitter {
	constructor({
		dir,
		read = true,
		enc = 'utf8',
		watch = true,
		debounce = 10,
		transform,
		generators = [],
		resolver,
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
		if (typeof resolver !== 'undefined' && typeof resolver !== 'function') {
			throw new TypeError('defiler: resolver must be a function')
		}
		super()
		this.paths = new Set() // set of original paths for all physical files
		this[_origData] = new Map() // original paths -> original file data for all physical files ({ path, stats, bytes, enc })
		this.files = new Map() // original paths -> transformed files for all physical and virtual files
		this[_status] = null // null = exec not called; false = exec pending; true = exec finished
		this[_watcher] = new Watcher({ dir: resolve(dir), read, enc, watch, debounce }) // Watcher instance
		this[_transform] = transform // the transform to run on all files
		this[_generators] = new Map(generators.map(generator => [Symbol(), generator])) // unique symbols -> registered generators
		this[_resolver] = resolver // (base, path) => path resolver function, used in defiler.get and defiler.add from transform
		this[_active] = new Set() // original paths of all files currently undergoing transformation and symbols of all generators currently running
		this[_waitingFor] = new Map() // original paths -> number of other files they're currently waiting on to exist
		this[_whenFound] = new Map() // original paths -> { promise, resolve } objects for when awaited files become available
		this[_cur] = { root: null, parent: null } // (set via proxy) root: the current root dependent, for use in _deps; parent: the current immediate dependent, for use in _waitingFor and the resolver
		this[_deps] = [] // array of [dependent, dependency] pairs, specifying changes to which files should trigger re-processing which other files
		this[_queue] = [] // queue of pending Watcher events to handle
		this[_isProcessing] = false // whether some Watcher event is currently already in the process of being handled
	}

	// execute everything, and return a promise that resolves when the first wave of processing is complete
	async exec() {
		if (this[_status] !== null) throw new Error('defiler.exec: cannot call more than once')
		this[_status] = false
		this[_isProcessing] = true
		let done = this[_startWave]()
		// init the Watcher instance
		this[_watcher].on('', event => this[_enqueue](event))
		let files = await this[_watcher].init()
		// note that all files are pending transformation
		for (let { path } of files) {
			this.paths.add(path)
			this[_active].add(path)
		}
		for (let symbol of this[_generators].keys()) this[_active].add(symbol)
		// process each physical file
		for (let { path, stats } of files) this[_processPhysicalFile](path, stats)
		// process each generator
		for (let symbol of this[_generators].keys()) this[_processGenerator](symbol)
		// wait and finish up
		await done
		this[_status] = true
		this[_isProcessing] = false
		this[_enqueue]()
	}

	// wait for a file to be available and retrieve it, marking dependencies as appropriate
	async get(path) {
		if (
			typeof path !== 'string' &&
			(!Array.isArray(path) || path.some(path => typeof path !== 'string'))
		) {
			throw new TypeError('defiler.get: path must be a string or an array of strings')
		}
		if (Array.isArray(path)) return Promise.all(path.map(path => this.get(path)))
		let { [_cur]: cur, [_waitingFor]: waitingFor } = this
		if (this[_resolver] && typeof cur.parent === 'string') {
			path = this[_resolver](cur.parent, path)
		}
		if (cur.root) this[_deps].push([cur.root, path])
		if (!this[_status] && !this.files.has(path)) {
			if (cur.parent) waitingFor.set(cur.parent, (waitingFor.get(cur.parent) || 0) + 1)
			if (!this[_whenFound].has(path)) {
				let resolve
				this[_whenFound].set(path, { promise: new Promise(res => (resolve = res)), resolve })
			}
			await this[_whenFound].get(path).promise
			if (cur.parent) waitingFor.set(cur.parent, waitingFor.get(cur.parent) - 1)
		}
		return this.files.get(path)
	}

	// add a new virtual file
	add(file) {
		if (this[_status] === null) throw new Error('defiler.add: cannot call before calling exec')
		if (typeof file !== 'object') throw new TypeError('defiler.add: file must be an object')
		if (this[_resolver] && typeof this[_cur].parent === 'string') {
			file.path = this[_resolver](this[_cur].parent, file.path)
		}
		this[_processFile](file)
	}

	// private methods

	// return a Promise that we will resolve at the end of this wave, and save its resolver
	[_startWave]() {
		return new Promise(res => (this[_endWave] = res))
	}

	// add a Watcher event to the queue, and handle queued events
	async [_enqueue](event) {
		if (event) this[_queue].push(event)
		if (this[_isProcessing]) return
		this[_isProcessing] = true
		while (this[_queue].length) {
			let { event, path, stats } = this[_queue].shift()
			let done = this[_startWave]()
			if (event === '+') {
				this[_processPhysicalFile](path, stats)
			} else if (event === '-') {
				let file = this.files.get(path)
				this.paths.delete(path)
				this[_origData].delete(path)
				this.files.delete(path)
				this.emit('deleted', { defiler: this, file })
				if (this[_status]) this[_processDependents](path)
			}
			await done
		}
		this[_isProcessing] = false
	}

	// create a file object for a physical file and process it
	async [_processPhysicalFile](path, stats) {
		let { dir, read, enc } = this[_watcher]
		let data = { path, stats, enc }
		if (read) data.bytes = await readFile(dir + '/' + path)
		this.paths.add(path)
		this[_origData].set(path, data)
		this.emit('read', { defiler: this, file: Object.assign(new File(), data) })
		await this[_processFile](data)
	}

	// transform a file, store it, and process dependents
	async [_processFile](data) {
		let file = Object.assign(new File(), data)
		let { path } = file
		this[_active].add(path)
		let defiler = this[_newProxy](path)
		try {
			await this[_transform]({ defiler, file })
		} catch (error) {
			this.emit('error', { defiler, file, error })
		}
		this.files.set(path, file)
		this.emit('file', { defiler: this, file })
		this[_markFound](path)
		if (this[_status]) this[_processDependents](path)
		this[_active].delete(path)
		if (!this[_active].size) {
			this[_endWave]()
		} else if (!this[_status] && [...this[_active]].every(path => this[_waitingFor].get(path))) {
			// all pending files are currently waiting for one or more other files to exist
			// break deadlock: assume all files that have not appeared yet will never do so
			for (let path of this[_whenFound].keys()) if (!this[_active].has(path)) this[_markFound](path)
		}
	}

	// re-process all files that depend on a particular path
	[_processDependents](path) {
		let dependents = new Set(this[_deps].map(([dependent, dep]) => dep === path && dependent))
		this[_deps] = this[_deps].filter(([dependent]) => !dependents.has(dependent))
		if (!dependents.size && !this[_active].size) this[_endWave]()
		for (let dependent of dependents) {
			if (this[_origData].has(dependent)) {
				this[_processFile](this[_origData].get(dependent))
			} else if (this[_generators].has(dependent)) {
				this[_processGenerator](dependent)
			}
		}
	}

	// run the generator given by the symbol
	async [_processGenerator](symbol) {
		this[_active].add(symbol)
		let generator = this[_generators].get(symbol)
		let defiler = this[_newProxy](symbol)
		try {
			await generator({ defiler })
		} catch (error) {
			this.emit('error', { defiler, generator, error })
		}
		this[_active].delete(symbol)
	}

	// create a defiler Proxy for the given path, always overriding _cur.parent and only overriding _cur.root if it is not yet set
	[_newProxy](path) {
		let cur = { root: this[_cur].root || path, parent: path }
		return new Proxy(this, { get: (_, key) => (key === _cur ? cur : this[key]) })
	}

	// mark a given awaited file as being found
	[_markFound](path) {
		if (!this[_status] && this[_whenFound].has(path)) {
			this[_whenFound].get(path).resolve()
			this[_whenFound].delete(path)
		}
	}
}
