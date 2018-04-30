import { readFile } from './fs.js';
import { resolve } from 'path';

import File from './File.js';
import Watcher from './Watcher.js';
import * as context from './context.js';

const _origData = Symbol();
const _status = Symbol();
const _before = Symbol();
const _during = Symbol();
const _after = Symbol();
const _watchers = Symbol();
const _transform = Symbol();
const _generators = Symbol();
const _resolver = Symbol();
const _onerror = Symbol();
const _active = Symbol();
const _waitingFor = Symbol();
const _whenFound = Symbol();
const _deps = Symbol();
const _queue = Symbol();
const _isProcessing = Symbol();
const _startWave = Symbol();
const _endWave = Symbol();
const _enqueue = Symbol();
const _processPhysicalFile = Symbol();
const _processFile = Symbol();
const _callTransform = Symbol();
const _processGenerator = Symbol();
const _checkWave = Symbol();
const _processDependents = Symbol();
const _markFound = Symbol();

export default class Defiler {
	constructor(...args) {
		const { transform, generators = [], resolver, onerror } = args.pop();
		if (typeof transform !== 'function') {
			throw new TypeError('defiler: transform must be a function');
		}
		if (
			!Array.isArray(generators) ||
			generators.some(generator => typeof generator !== 'function')
		) {
			throw new TypeError('defiler: generators must be an array of functions');
		}
		if (resolver && typeof resolver !== 'function') {
			throw new TypeError('defiler: resolver must be a function');
		}
		if (onerror && typeof onerror !== 'function') {
			throw new TypeError('defiler: onerror must be a function');
		}
		// set of original paths for all physical files
		this.paths = new Set();
		// original paths -> original file data for all physical files ({ path, stats, bytes, enc })
		this[_origData] = new Map();
		// original paths -> transformed files for all physical and virtual files
		this.files = new Map();
		// _before, _during, or _after exec has been called
		this[_status] = _before;
		// Watcher instances
		this[_watchers] = args.map(
			({
				dir,
				filter,
				read = true,
				enc = 'utf8',
				pre,
				watch = true,
				debounce = 10,
			}) => {
				if (typeof dir !== 'string') {
					throw new TypeError('defiler: dir must be a string');
				}
				if (filter && typeof filter !== 'function') {
					throw new TypeError('defiler: filter must be a function');
				}
				if (typeof read !== 'boolean' && typeof read !== 'function') {
					throw new TypeError('defiler: read must be a boolean or a function');
				}
				if (!Buffer.isEncoding(enc) && typeof enc !== 'function') {
					throw new TypeError(
						'defiler: enc must be a supported encoding or a function',
					);
				}
				if (pre && typeof pre !== 'function') {
					throw new TypeError('defiler: pre must be a function');
				}
				if (typeof watch !== 'boolean') {
					throw new TypeError('defiler: watch must be a boolean');
				}
				if (typeof debounce !== 'number') {
					throw new TypeError('defiler: debounce must be a number');
				}
				return new Watcher({
					dir: resolve(dir),
					filter,
					read,
					enc,
					pre,
					watch,
					debounce,
				});
			},
		);
		// the transform to run on all files
		this[_transform] = transform;
		// unique symbols -> registered generators
		this[_generators] = new Map(
			generators.map(generator => [Symbol(), generator]),
		);
		// (base, path) => path resolver function, used in defiler.get and defiler.add from transform
		this[_resolver] = resolver;
		// handler to call when errors occur
		this[_onerror] = onerror;
		// original paths of all files currently undergoing transformation and symbols of all generators currently running
		this[_active] = new Set();
		// original paths -> number of other files they're currently waiting on to exist
		this[_waitingFor] = new Map();
		// original paths -> { promise, resolve } objects for when awaited files become available
		this[_whenFound] = new Map();
		// array of [dependent, dependency] pairs, specifying changes to which files should trigger re-processing which other files
		this[_deps] = [];
		// queue of pending Watcher events to handle
		this[_queue] = [];
		// whether some Watcher event is currently already in the process of being handled
		this[_isProcessing] = false;
	}

	// execute everything, and return a promise that resolves when the first wave of processing is complete
	async exec() {
		if (this[_status] !== _before) {
			throw new Error('defiler.exec: cannot call more than once');
		}
		this[_status] = _during;
		this[_isProcessing] = true;
		const done = this[_startWave]();
		// init the Watcher instances
		const files = [];
		await Promise.all(
			this[_watchers].map(async watcher => {
				watcher.on('', event => this[_enqueue](watcher, event));
				// note that all files are pending transformation
				await Promise.all(
					(await watcher.init()).map(async file => {
						const { path } = file;
						if (watcher.pre) {
							await watcher.pre(file);
						}
						this.paths.add(file.path);
						this[_active].add(file.path);
						files.push([watcher, path, file]);
					}),
				);
			}),
		);
		for (const symbol of this[_generators].keys()) {
			this[_active].add(symbol);
		}
		// process each physical file
		for (const [watcher, path, file] of files) {
			this[_processPhysicalFile](watcher, path, file);
		}
		// process each generator
		for (const symbol of this[_generators].keys()) {
			this[_processGenerator](symbol);
		}
		// wait and finish up
		await done;
		this[_status] = _after;
		this[_isProcessing] = false;
		this[_enqueue]();
	}

	// wait for a file to be available and retrieve it, marking dependencies as appropriate
	async get(path) {
		if (Array.isArray(path)) {
			return Promise.all(path.map(path => this.get(path)));
		}
		const waitingFor = this[_waitingFor];
		const current = context.current();
		path = this.resolve(path);
		if (typeof path !== 'string') {
			throw new TypeError('defiler.get: path must be a string');
		}
		if (current) {
			this[_deps].push([current, path]);
		}
		if (this[_status] === _during && !this.files.has(path)) {
			if (current) {
				waitingFor.set(current, (waitingFor.get(current) || 0) + 1);
			}
			if (this[_whenFound].has(path)) {
				await this[_whenFound].get(path).promise;
			} else {
				let resolve;
				let promise = new Promise(res => (resolve = res));
				this[_whenFound].set(path, { promise, resolve });
				await promise;
			}
			if (current) {
				waitingFor.set(current, waitingFor.get(current) - 1);
			}
		}
		return this.files.get(path);
	}

	// add a new virtual file
	add(file) {
		if (this[_status] === _before) {
			throw new Error('defiler.add: cannot call before calling exec');
		}
		if (typeof file !== 'object') {
			throw new TypeError('defiler.add: file must be an object');
		}
		file.path = this.resolve(file.path);
		this[_origData].set(file.path, file);
		this[_processFile](file, 'add');
	}

	// resolve a given path from the file currently being transformed
	resolve(path) {
		return this[_resolver] && typeof context.current() === 'string'
			? this[_resolver](context.current(), path)
			: path;
	}

	// private methods

	// return a Promise that we will resolve at the end of this wave, and save its resolver
	[_startWave]() {
		return new Promise(res => (this[_endWave] = res));
	}

	// add a Watcher event to the queue, and handle queued events
	async [_enqueue](watcher, event) {
		if (event) {
			this[_queue].push([watcher, event]);
		}
		if (this[_isProcessing]) {
			return;
		}
		this[_isProcessing] = true;
		while (this[_queue].length) {
			const done = this[_startWave]();
			const [watcher, { event, path, stats }] = this[_queue].shift();
			const file = { path, stats };
			if (watcher.pre) {
				await watcher.pre(file);
			}
			if (event === '+') {
				this[_processPhysicalFile](watcher, path, file);
			} else if (event === '-') {
				const { path } = file;
				const oldFile = this.files.get(path);
				this.paths.delete(path);
				this[_origData].delete(path);
				this.files.delete(path);
				await this[_callTransform](oldFile, 'delete');
				this[_processDependents](path);
			}
			await done;
		}
		this[_isProcessing] = false;
	}

	// create a file object for a physical file and process it
	async [_processPhysicalFile]({ dir, read, enc }, path, file) {
		if (typeof read === 'function') {
			read = await read({ path, stats: file.stats });
		}
		if (read) {
			file.bytes = await readFile(dir + '/' + path);
		}
		if (typeof enc === 'function') {
			enc = await enc({ path, stats: file.stats, bytes: file.bytes });
		}
		file.enc = enc;
		this.paths.add(file.path);
		this[_origData].set(file.path, file);
		await this[_processFile](file, 'read');
	}

	// transform a file, store it, and process dependents
	async [_processFile](data, event) {
		const file = Object.assign(new File(), data);
		const { path } = file;
		this[_active].add(path);
		await this[_callTransform](file, event);
		this.files.set(path, file);
		this[this[_status] === _during ? _markFound : _processDependents](path);
		this[_active].delete(path);
		this[_checkWave]();
	}

	// call the transform on a file with the given event string, and handle errors
	async [_callTransform](file, event) {
		await null;
		context.create(file.path);
		try {
			await this[_transform]({ file, event });
		} catch (error) {
			if (this[_onerror]) {
				this[_onerror]({ file, event, error });
			}
		}
	}

	// run the generator given by the symbol
	async [_processGenerator](symbol) {
		this[_active].add(symbol);
		const generator = this[_generators].get(symbol);
		await null;
		context.create(symbol);
		try {
			await generator();
		} catch (error) {
			if (this[_onerror]) {
				this[_onerror]({ generator, error });
			}
		}
		this[_active].delete(symbol);
		this[_checkWave]();
	}

	// re-process all files that depend on a particular path
	[_processDependents](path) {
		const dependents = new Set();
		for (const [dependent, dependency] of this[_deps]) {
			if (dependency === path) {
				dependents.add(dependent);
			}
		}
		this[_deps] = this[_deps].filter(
			([dependent]) => !dependents.has(dependent),
		);
		for (const dependent of dependents) {
			if (this[_origData].has(dependent)) {
				this[_processFile](this[_origData].get(dependent), 'retransform');
			} else if (this[_generators].has(dependent)) {
				this[_processGenerator](dependent);
			}
		}
		this[_checkWave]();
	}

	// check whether this wave is complete, and, if not, whether we need to break a deadlock
	[_checkWave]() {
		if (!this[_active].size) {
			this[_endWave]();
		} else if (
			this[_status] === _during &&
			[...this[_active]].every(path => this[_waitingFor].get(path))
		) {
			// all pending files are currently waiting for one or more other files to exist
			// break deadlock: assume all files that have not appeared yet will never do so
			for (const path of this[_whenFound].keys()) {
				if (!this[_active].has(path)) {
					this[_markFound](path);
				}
			}
		}
	}

	// mark a given awaited file as being found
	[_markFound](path) {
		if (this[_whenFound].has(path)) {
			this[_whenFound].get(path).resolve();
			this[_whenFound].delete(path);
		}
	}
}
