import EventEmitter from 'events'
import { readFile } from './fs.js'
import { resolve } from 'path'

import File from './File.js'
import Watcher from './Watcher.js'

import symbols from './symbols.js'
// prettier-ignore
let { _origData, _status, _watchers, _transform, _generators, _resolver, _active, _waitingFor, _whenFound, _deps, _queue, _isProcessing, _startWave, _endWave, _enqueue, _processPhysicalFile, _processFile, _processGenerator, _checkWave, _parent, _newProxy, _processDependents, _markFound } = symbols

export default class Defiler extends EventEmitter {
	constructor(...dirs) {
		let { transform, generators = [], resolver } = dirs.pop()
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
		this[_watchers] = dirs.map(
			({ dir, filter, read = true, enc = 'utf8', pre, watch = true, debounce = 10 }) => {
				if (typeof dir !== 'string') throw new TypeError('defiler: dir must be a string')
				if (typeof filter !== 'undefined' && typeof filter !== 'function') {
					throw new TypeError('defiler: filter must be a function')
				}
				if (typeof read !== 'boolean' && typeof read !== 'function') {
					throw new TypeError('defiler: read must be a boolean or a function')
				}
				if (!Buffer.isEncoding(enc) && typeof enc !== 'function') {
					throw new TypeError('defiler: enc must be a supported encoding or a function')
				}
				if (typeof pre !== 'undefined' && typeof pre !== 'function') {
					throw new TypeError('defiler: pre must be a function')
				}
				if (typeof watch !== 'boolean') throw new TypeError('defiler: watch must be a boolean')
				if (typeof debounce !== 'number') throw new TypeError('defiler: debounce must be a number')
				return new Watcher({ dir: resolve(dir), filter, read, enc, pre, watch, debounce })
			},
		) // Watcher instances
		this[_transform] = transform // the transform to run on all files
		this[_generators] = new Map(generators.map(generator => [Symbol(), generator])) // unique symbols -> registered generators
		this[_resolver] = resolver // (base, path) => path resolver function, used in defiler.get and defiler.add from transform
		this[_active] = new Set() // original paths of all files currently undergoing transformation and symbols of all generators currently running
		this[_waitingFor] = new Map() // original paths -> number of other files they're currently waiting on to exist
		this[_whenFound] = new Map() // original paths -> { promise, resolve } objects for when awaited files become available
		this[_parent] = null // (set via proxy) the current immediate dependent (path or generator symbol), for use in _deps, _waitingFor, and the resolver
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
		// init the Watcher instances
		let files = []
		await Promise.all(
			this[_watchers].map(async watcher => {
				watcher.on('', event => this[_enqueue](watcher, event))
				// note that all files are pending transformation
				await Promise.all(
					(await watcher.init()).map(async file => {
						let { path } = file
						if (watcher.pre) await watcher.pre(file)
						this.paths.add(file.path)
						this[_active].add(file.path)
						files.push([watcher, path, file])
					}),
				)
			}),
		)
		for (let symbol of this[_generators].keys()) this[_active].add(symbol)
		// process each physical file
		for (let [watcher, path, file] of files) this[_processPhysicalFile](watcher, path, file)
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
		if (Array.isArray(path)) return Promise.all(path.map(path => this.get(path)))
		let { [_parent]: parent, [_waitingFor]: waitingFor } = this
		if (this[_resolver] && typeof parent === 'string') path = this[_resolver](parent, path)
		if (typeof path !== 'string') throw new TypeError('defiler.get: path must be a string')
		if (parent) this[_deps].push([parent, path])
		if (!this[_status] && !this.files.has(path)) {
			if (parent) waitingFor.set(parent, (waitingFor.get(parent) || 0) + 1)
			if (!this[_whenFound].has(path)) {
				let resolve
				this[_whenFound].set(path, { promise: new Promise(res => (resolve = res)), resolve })
			}
			await this[_whenFound].get(path).promise
			if (parent) waitingFor.set(parent, waitingFor.get(parent) - 1)
		}
		return this.files.get(path)
	}

	// add a new virtual file
	add(file) {
		if (this[_status] === null) throw new Error('defiler.add: cannot call before calling exec')
		if (typeof file !== 'object') throw new TypeError('defiler.add: file must be an object')
		if (this[_resolver] && typeof this[_parent] === 'string') {
			file.path = this[_resolver](this[_parent], file.path)
		}
		this[_processFile](file)
	}

	// private methods

	// return a Promise that we will resolve at the end of this wave, and save its resolver
	[_startWave]() {
		return new Promise(res => (this[_endWave] = res))
	}

	// add a Watcher event to the queue, and handle queued events
	async [_enqueue](watcher, event) {
		if (event) this[_queue].push([watcher, event])
		if (this[_isProcessing]) return
		this[_isProcessing] = true
		while (this[_queue].length) {
			let done = this[_startWave]()
			let [watcher, { event, path, stats }] = this[_queue].shift()
			let file = { path, stats }
			if (watcher.pre) await watcher.pre(file)
			if (event === '+') this[_processPhysicalFile](watcher, path, file)
			else if (event === '-') {
				let { path } = file
				file = this.files.get(path)
				this.paths.delete(path)
				this[_origData].delete(path)
				this.files.delete(path)
				this.emit('deleted', { defiler: this, file })
				this[_processDependents](path)
			}
			await done
		}
		this[_isProcessing] = false
	}

	// create a file object for a physical file and process it
	async [_processPhysicalFile]({ dir, read, enc }, path, file) {
		if (typeof read === 'function') read = await read({ path, stats: file.stats })
		if (read) file.bytes = await readFile(dir + '/' + path)
		if (typeof enc === 'function') enc = await enc({ path, stats: file.stats, bytes: file.bytes })
		file.enc = enc
		this.paths.add(file.path)
		this[_origData].set(file.path, file)
		this.emit('read', { defiler: this, file })
		await this[_processFile](file)
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
		this[_checkWave]()
	}

	// re-process all files that depend on a particular path
	[_processDependents](path) {
		let dependents = new Set()
		for (let [dependent, dep] of this[_deps]) if (dep === path) dependents.add(dependent)
		this[_deps] = this[_deps].filter(([dependent]) => !dependents.has(dependent))
		if (!dependents.size && !this[_active].size) this[_endWave]()
		for (let dependent of dependents) {
			if (this[_origData].has(dependent)) this[_processFile](this[_origData].get(dependent))
			else if (this[_generators].has(dependent)) this[_processGenerator](dependent)
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
		this[_checkWave]()
	}

	// check whether this wave is complete, and, if not, whether we need to break a deadlock
	[_checkWave]() {
		if (!this[_active].size) this[_endWave]()
		else if (!this[_status] && [...this[_active]].every(path => this[_waitingFor].get(path))) {
			// all pending files are currently waiting for one or more other files to exist
			// break deadlock: assume all files that have not appeared yet will never do so
			for (let path of this[_whenFound].keys()) if (!this[_active].has(path)) this[_markFound](path)
		}
	}

	// create a defiler Proxy for the given path or generator symbol
	[_newProxy](path) {
		return new Proxy(this, { get: (_, key) => (key === _parent ? path : this[key]) })
	}

	// mark a given awaited file as being found
	[_markFound](path) {
		if (!this[_status] && this[_whenFound].has(path)) {
			this[_whenFound].get(path).resolve()
			this[_whenFound].delete(path)
		}
	}
}
