import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs';
import { resolve } from 'path';

import File from './File.js';
import Watcher from './Watcher.js';

export default class Defiler {
	// set of original paths for all physical files
	/** @type {Set<string>} */ paths = new Set();
	// original paths -> original file data for all physical files ({ path, stats, bytes, enc })
	/** @type {Map<string, FileData>} */ _orig_data = new Map();
	// original paths -> transformed files for all physical and virtual files
	/** @type {Map<string, File>} */ files = new Map();
	// Before, During, or After exec has been called
	/** @type {Status} */ _status = Status.Before;
	// AsyncLocalStorage instance for tracking call stack contexts and dependencies
	/** @type {AsyncLocalStorage<Name>} */ _context = new AsyncLocalStorage();
	// Watcher instances
	/** @type {WatcherData[]} */ _watchers;
	// the transform to run on all files
	/** @type {Transform} */ _transform;
	// registered generators
	/** @type {Generator[]} */ _generators;
	// (base, path) => path resolver function, used in defiler.get and defiler.add from transform
	/** @type {Resolver} */ _resolver;
	// handler to call when errors occur
	/** @type {OnError} */ _onerror;
	// original paths of all files currently undergoing transformation and symbols of all generators currently running
	/** @type {Set<Name>} */ _active = new Set();
	// original paths -> { promise, resolve, paths } objects for when awaited files become available
	/** @type {Map<string | Filter, WhenFound>} */ _when_found = new Map();
	// array of [dependent, dependency] pairs, specifying changes to which files should trigger re-processing which other files
	/** @type {[Name, string | Filter][]} */ _deps = [];
	// queue of pending Watcher events to handle
	/** @type {[WatcherData, WatcherEvent][]} */ _queue = [];
	// whether some Watcher event is currently already in the process of being handled
	/** @type {boolean} */ _is_processing = false;
	// end the current wave
	/** @type {() => void} */ _end_wave = null;

	constructor(...args) {
		const { transform, generators = [], resolver, onerror } = /** @type {DefilerData} */ (args.pop());
		if (typeof transform !== 'function') {
			throw new TypeError('defiler: transform must be a function');
		}
		if (!Array.isArray(generators) || generators.some((generator) => typeof generator !== 'function')) {
			throw new TypeError('defiler: generators must be an array of functions');
		}
		if (resolver && typeof resolver !== 'function') {
			throw new TypeError('defiler: resolver must be a function');
		}
		if (onerror && typeof onerror !== 'function') {
			throw new TypeError('defiler: onerror must be a function');
		}
		this._watchers = args.map(({ dir, filter, read = true, enc = 'utf8', pre, watch = true, debounce = 10 }) => {
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
				throw new TypeError('defiler: enc must be a supported encoding or a function');
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
			return /** @type {WatcherData} */ (new Watcher({ dir, filter, read, enc, pre, watch, debounce }));
		});
		this._transform = transform;
		this._generators = generators;
		this._resolver = resolver;
		this._onerror = onerror;
	}

	// execute everything, and return a promise that resolves when the first wave of processing is complete
	async exec() {
		if (this._status !== Status.Before) {
			throw new Error('defiler.exec: cannot call more than once');
		}
		this._status = Status.During;
		this._is_processing = true;
		const done = this._start_wave();
		// init the Watcher instances
		/** @type {[WatcherData, string, { path: string; stats: fs.Stats }][]} */ const files = [];
		await Promise.all(
			this._watchers.map(async (watcher) => {
				watcher.dir = resolve(watcher.dir);
				watcher.on('', (event) => this._enqueue(watcher, event));
				// note that all files are pending transformation
				await Promise.all(
					(
						await watcher.init()
					).map(async (file) => {
						const { path } = file;
						if (watcher.pre) {
							await watcher.pre(file);
						}
						this.paths.add(file.path);
						this._active.add(file.path);
						files.push([watcher, path, file]);
					}),
				);
			}),
		);
		for (const generator of this._generators) {
			this._active.add(generator);
		}
		// process each physical file
		for (const [watcher, path, file] of files) {
			this._process_physical_file(watcher, path, file);
		}
		// process each generator
		for (const generator of this._generators) {
			this._process_generator(generator);
		}
		// wait and finish up
		await done;
		this._status = Status.After;
		this._is_processing = false;
		if (this._watchers.some((watcher) => watcher.watch)) {
			this._enqueue();
		}
	}

	// wait for a file to be available and retrieve it, marking dependencies as appropriate
	async get(_) {
		if (typeof _ === 'string') {
			_ = this.resolve(_);
		}
		if (Array.isArray(_)) {
			return Promise.all(_.map((path) => this.get(path)));
		}
		if (typeof _ !== 'string' && typeof _ !== 'function') {
			throw new TypeError('defiler.get: argument must be a string, an array, or a function');
		}
		const current = this._context.getStore();
		if (current) {
			this._deps.push([current, _]);
		}
		if (this._status === Status.During && current && (typeof _ === 'function' || !this.files.has(_))) {
			if (this._when_found.has(_)) {
				const { promise, paths } = this._when_found.get(_);
				paths.push(current);
				await promise;
			} else {
				let resolve;
				/** @type {Promise<void>} */ const promise = new Promise((res) => (resolve = res));
				this._when_found.set(_, { promise, resolve, paths: [current] });
				await promise;
			}
		}
		return typeof _ === 'function' ? this.get([...this.files.keys()].filter(_).sort()) : this.files.get(_);
	}

	// add a new virtual file
	add(/** @type {FileData} */ file) {
		if (this._status === Status.Before) {
			throw new Error('defiler.add: cannot call before calling exec');
		}
		if (typeof file !== 'object') {
			throw new TypeError('defiler.add: file must be an object');
		}
		file.path = this.resolve(file.path);
		this._orig_data.set(file.path, file);
		return this._process_file(file, 'add');
	}

	// resolve a given path from the file currently being transformed
	resolve(/** @type {string} */ path) {
		if (this._resolver) {
			const current = this._context.getStore();
			if (typeof current === 'string') {
				return this._resolver(current, path);
			}
		}
		return path;
	}

	// private methods

	// return a Promise that we will resolve at the end of this wave, and save its resolver
	_start_wave() {
		return new Promise((res) => (this._end_wave = res));
	}

	// add a Watcher event to the queue, and handle queued events
	async _enqueue(/** @type {WatcherData} */ watcher, /** @type {WatcherEvent} */ event) {
		if (event) {
			this._queue.push([watcher, event]);
		}
		if (this._is_processing) {
			return;
		}
		this._is_processing = true;
		while (this._queue.length) {
			const done = this._start_wave();
			const [watcher, { event, path, stats }] = this._queue.shift();
			const file = { path, stats };
			if (watcher.pre) {
				await watcher.pre(file);
			}
			if (event === '+') {
				this._process_physical_file(watcher, path, file);
			} else if (event === '-') {
				const { path } = file;
				const old_file = this.files.get(path);
				this.paths.delete(path);
				this._orig_data.delete(path);
				this.files.delete(path);
				await this._call_transform(old_file, 'delete');
				this._process_dependents(path);
			}
			await done;
		}
		this._is_processing = false;
	}

	// create a file object for a physical file and process it
	async _process_physical_file(
		/** @type {WatcherData} */ { dir, read, enc },
		/** @type {string} */ path,
		/** @type {FileData} */ file,
	) {
		if (typeof read === 'function') {
			read = await read({ path, stats: file.stats });
		}
		if (read) {
			file.bytes = await fs.promises.readFile(dir + '/' + path);
		}
		if (typeof enc === 'function') {
			enc = await enc({ path, stats: file.stats, bytes: file.bytes });
		}
		file.enc = enc;
		this.paths.add(file.path);
		this._orig_data.set(file.path, file);
		await this._process_file(file, 'read');
	}

	// transform a file, store it, and process dependents
	async _process_file(/** @type {FileData} */ data, /** @type {string} */ event) {
		const file = Object.assign(new File(), data);
		const { path } = file;
		this._active.add(path);
		await this._call_transform(file, event);
		this.files.set(path, file);
		if (this._status === Status.During) {
			this._mark_found(path);
		} else {
			this._process_dependents(path);
		}
		this._active.delete(path);
		this._check_wave();
	}

	// call the transform on a file with the given event string, and handle errors
	async _call_transform(/** @type {File} */ file, /** @type {string} */ event) {
		try {
			await this._context.run(file.path, () => this._transform({ file, event }));
		} catch (error) {
			if (this._onerror) {
				this._onerror({ file, event, error });
			}
		}
	}

	// run the generator given by the symbol
	async _process_generator(/** @type {Generator} */ generator) {
		this._active.add(generator);
		try {
			await this._context.run(generator, generator);
		} catch (error) {
			if (this._onerror) {
				this._onerror({ generator, error });
			}
		}
		this._active.delete(generator);
		this._check_wave();
	}

	// re-process all files that depend on a particular path
	_process_dependents(/** @type {string} */ path) {
		/** @type {Set<Name>} */ const dependents = new Set();
		for (const [dependent, dependency] of this._deps) {
			if (typeof dependency === 'string' ? dependency === path : dependency(path)) {
				dependents.add(dependent);
			}
		}
		this._deps = this._deps.filter(([dependent]) => !dependents.has(dependent));
		for (const dependent of dependents) {
			if (typeof dependent === 'function') {
				this._process_generator(dependent);
			} else if (this._orig_data.has(dependent)) {
				this._process_file(this._orig_data.get(dependent), 'retransform');
			}
		}
		this._check_wave();
	}

	// check whether this wave is complete, and, if not, whether we need to break a deadlock
	_check_wave() {
		if (!this._active.size) {
			this._end_wave();
		} else if (this._status === 1) {
			/** @type {Set<Name>} */ const filter_waiting = new Set();
			/** @type {Set<Name>} */ const all_waiting = new Set();
			for (const [path, { paths }] of this._when_found) {
				if (typeof path === 'function' || this._active.has(path)) {
					paths.forEach((path) => filter_waiting.add(path));
				}
				paths.forEach((path) => all_waiting.add(path));
			}
			if ([...this._active].every((path) => filter_waiting.has(path))) {
				// all pending files are currently waiting for a filter or another pending file
				// break deadlock: assume all filters have found all they're going to find
				for (const path of this._when_found.keys()) {
					if (typeof path === 'function') {
						this._mark_found(path);
					}
				}
			} else if ([...this._active].every((path) => all_waiting.has(path))) {
				// all pending files are currently waiting for one or more other files to exist
				// break deadlock: assume all files that have not appeared yet will never do so
				for (const path of this._when_found.keys()) {
					if (typeof path === 'string' && !this._active.has(path)) {
						this._mark_found(path);
					}
				}
			}
		}
	}

	// mark a given awaited file as being found
	_mark_found(/** @type {string | Filter} */ path) {
		if (this._when_found.has(path)) {
			this._when_found.get(path).resolve();
			this._when_found.delete(path);
		}
	}
}

/**
 * @typedef {object} DefilerData
 * @property {Transform} transform
 * @property {Generator[]} generators
 * @property {Resolver} resolver
 * @property {OnError} onerror
 */

/**
 * @typedef {object} FileData
 * @property {string} path
 */
// TODO: [prop: string]: any

/** @typedef {(path: string) => boolean} Filter */

/** @typedef {() => Promise<void>} Generator */

/** @typedef {string | Generator} Name */

/** @typedef {(arg: { file?: any; event?: string; generator?: Generator; error: Error }) => void} OnError */

/** @typedef {(base: string, path: string) => string} Resolver */

/** @enum {number} */
const Status = {
	Before: 0,
	During: 1,
	After: 2,
};

/** @typedef {(arg: { file: File; event: string }) => Promise<void>} Transform */

/**
 * @typedef {object} WatcherData
 * @extends Watcher
 * @property {boolean | ((arg: { path: string; stats: fs.Stats }) => Promise<boolean>)} read
 * @property {((arg: { path: string; stats: fs.Stats; bytes: Buffer }) => Promise<string>)} enc
 * @property {(data: FileData) => Promise<void>} pre
 */
// TODO fix this

/**
 * @typedef {object} WatcherEvent
 * @property {string} event
 * @property {string} path
 * @property {fs.Stats} stats
 */

/**
 * @typedef {object} WhenFound
 * @property {Promise<void>} promise
 * @property {() => void} resolve
 * @property {Name[]} paths
 */
