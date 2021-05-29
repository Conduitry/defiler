import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs';
import { resolve } from 'path';

import File from './File.js';
import Watcher from './Watcher.js';

export default class Defiler {
	// set of original paths for all physical files
	/** @type {Set<string>} */ paths = new Set();
	// original paths -> original file data for all physical files ({ path, stats, bytes, enc })
	/** @type {Map<string, FileData>} */ #orig_data = new Map();
	// original paths -> transformed files for all physical and virtual files
	/** @type {Map<string, File>} */ files = new Map();
	// Before, During, or After exec has been called
	/** @type {Status} */ #status = Status.Before;
	// AsyncLocalStorage instance for tracking call stack contexts and dependencies
	/** @type {AsyncLocalStorage<Name>} */ #context = new AsyncLocalStorage();
	// Watcher instances
	/** @type {WatcherData[]} */ #watchers;
	// the transform to run on all files
	/** @type {Transform} */ #transform;
	// registered generators
	/** @type {Generator[]} */ #generators;
	// (base, path) => path resolver function, used in defiler.get and defiler.add from transform
	/** @type {Resolver} */ #resolver;
	// handler to call when errors occur
	/** @type {OnError} */ #onerror;
	// original paths of all files currently undergoing transformation and symbols of all generators currently running
	/** @type {Set<Name>} */ #active = new Set();
	// original paths -> { promise, resolve, paths } objects for when awaited files become available
	/** @type {Map<string | Filter, WhenFound>} */ #when_found = new Map();
	// array of [dependent, dependency] pairs, specifying changes to which files should trigger re-processing which other files
	/** @type {[Name, string | Filter][]} */ #deps = [];
	// queue of pending Watcher events to handle
	/** @type {[WatcherData, WatcherEvent][]} */ #queue = [];
	// whether some Watcher event is currently already in the process of being handled
	/** @type {boolean} */ #is_processing = false;
	// end the current wave
	/** @type {() => void} */ #end_wave = null;

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
		this.#watchers = args.map(({ dir, filter, read = true, enc = 'utf8', pre, watch = true, debounce = 10 }) => {
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
		this.#transform = transform;
		this.#generators = generators;
		this.#resolver = resolver;
		this.#onerror = onerror;
	}

	// execute everything, and return a promise that resolves when the first wave of processing is complete
	async exec() {
		if (this.#status !== Status.Before) {
			throw new Error('defiler.exec: cannot call more than once');
		}
		this.#status = Status.During;
		this.#is_processing = true;
		const done = this.#start_wave();
		// init the Watcher instances
		/** @type {[WatcherData, string, { path: string; stats: fs.Stats }][]} */ const files = [];
		await Promise.all(
			this.#watchers.map(async (watcher) => {
				watcher.dir = resolve(watcher.dir);
				watcher.on('', (event) => this.#enqueue(watcher, event));
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
						this.#active.add(file.path);
						files.push([watcher, path, file]);
					}),
				);
			}),
		);
		for (const generator of this.#generators) {
			this.#active.add(generator);
		}
		// process each physical file
		for (const [watcher, path, file] of files) {
			this.#process_physical_file(watcher, path, file);
		}
		// process each generator
		for (const generator of this.#generators) {
			this.#process_generator(generator);
		}
		// wait and finish up
		await done;
		this.#status = Status.After;
		this.#is_processing = false;
		if (this.#watchers.some((watcher) => watcher.watch)) {
			this.#enqueue();
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
		const current = this.#context.getStore();
		if (current) {
			this.#deps.push([current, _]);
		}
		if (this.#status === Status.During && current && (typeof _ === 'function' || !this.files.has(_))) {
			if (this.#when_found.has(_)) {
				const { promise, paths } = this.#when_found.get(_);
				paths.push(current);
				await promise;
			} else {
				let resolve;
				/** @type {Promise<void>} */ const promise = new Promise((res) => (resolve = res));
				this.#when_found.set(_, { promise, resolve, paths: [current] });
				await promise;
			}
		}
		return typeof _ === 'function' ? this.get([...this.files.keys()].filter(_).sort()) : this.files.get(_);
	}

	// add a new virtual file
	add(/** @type {FileData} */ file) {
		if (this.#status === Status.Before) {
			throw new Error('defiler.add: cannot call before calling exec');
		}
		if (typeof file !== 'object') {
			throw new TypeError('defiler.add: file must be an object');
		}
		file.path = this.resolve(file.path);
		this.#orig_data.set(file.path, file);
		return this.#process_file(file, 'add');
	}

	// resolve a given path from the file currently being transformed
	resolve(/** @type {string} */ path) {
		if (this.#resolver) {
			const current = this.#context.getStore();
			if (typeof current === 'string') {
				return this.#resolver(current, path);
			}
		}
		return path;
	}

	// private methods

	// return a Promise that we will resolve at the end of this wave, and save its resolver
	#start_wave() {
		return new Promise((res) => (this.#end_wave = res));
	}

	// add a Watcher event to the queue, and handle queued events
	async #enqueue(/** @type {WatcherData} */ watcher, /** @type {WatcherEvent} */ event) {
		if (event) {
			this.#queue.push([watcher, event]);
		}
		if (this.#is_processing) {
			return;
		}
		this.#is_processing = true;
		while (this.#queue.length) {
			const done = this.#start_wave();
			const [watcher, { event, path, stats }] = this.#queue.shift();
			const file = { path, stats };
			if (watcher.pre) {
				await watcher.pre(file);
			}
			if (event === '+') {
				this.#process_physical_file(watcher, path, file);
			} else if (event === '-') {
				const { path } = file;
				const old_file = this.files.get(path);
				this.paths.delete(path);
				this.#orig_data.delete(path);
				this.files.delete(path);
				await this.#call_transform(old_file, 'delete');
				this.#process_dependents(path);
			}
			await done;
		}
		this.#is_processing = false;
	}

	// create a file object for a physical file and process it
	async #process_physical_file(
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
		this.#orig_data.set(file.path, file);
		await this.#process_file(file, 'read');
	}

	// transform a file, store it, and process dependents
	async #process_file(/** @type {FileData} */ data, /** @type {string} */ event) {
		const file = Object.assign(new File(), data);
		const { path } = file;
		this.#active.add(path);
		await this.#call_transform(file, event);
		this.files.set(path, file);
		if (this.#status === Status.During) {
			this.#mark_found(path);
		} else {
			this.#process_dependents(path);
		}
		this.#active.delete(path);
		this.#check_wave();
	}

	// call the transform on a file with the given event string, and handle errors
	async #call_transform(/** @type {File} */ file, /** @type {string} */ event) {
		try {
			await this.#context.run(file.path, () => this.#transform({ file, event }));
		} catch (error) {
			if (this.#onerror) {
				this.#onerror({ file, event, error });
			}
		}
	}

	// run the generator given by the symbol
	async #process_generator(/** @type {Generator} */ generator) {
		this.#active.add(generator);
		try {
			await this.#context.run(generator, generator);
		} catch (error) {
			if (this.#onerror) {
				this.#onerror({ generator, error });
			}
		}
		this.#active.delete(generator);
		this.#check_wave();
	}

	// re-process all files that depend on a particular path
	#process_dependents(/** @type {string} */ path) {
		/** @type {Set<Name>} */ const dependents = new Set();
		for (const [dependent, dependency] of this.#deps) {
			if (typeof dependency === 'string' ? dependency === path : dependency(path)) {
				dependents.add(dependent);
			}
		}
		this.#deps = this.#deps.filter(([dependent]) => !dependents.has(dependent));
		for (const dependent of dependents) {
			if (typeof dependent === 'function') {
				this.#process_generator(dependent);
			} else if (this.#orig_data.has(dependent)) {
				this.#process_file(this.#orig_data.get(dependent), 'retransform');
			}
		}
		this.#check_wave();
	}

	// check whether this wave is complete, and, if not, whether we need to break a deadlock
	#check_wave() {
		if (!this.#active.size) {
			this.#end_wave();
		} else if (this.#status === 1) {
			/** @type {Set<Name>} */ const filter_waiting = new Set();
			/** @type {Set<Name>} */ const all_waiting = new Set();
			for (const [path, { paths }] of this.#when_found) {
				if (typeof path === 'function' || this.#active.has(path)) {
					paths.forEach((path) => filter_waiting.add(path));
				}
				paths.forEach((path) => all_waiting.add(path));
			}
			if ([...this.#active].every((path) => filter_waiting.has(path))) {
				// all pending files are currently waiting for a filter or another pending file
				// break deadlock: assume all filters have found all they're going to find
				for (const path of this.#when_found.keys()) {
					if (typeof path === 'function') {
						this.#mark_found(path);
					}
				}
			} else if ([...this.#active].every((path) => all_waiting.has(path))) {
				// all pending files are currently waiting for one or more other files to exist
				// break deadlock: assume all files that have not appeared yet will never do so
				for (const path of this.#when_found.keys()) {
					if (typeof path === 'string' && !this.#active.has(path)) {
						this.#mark_found(path);
					}
				}
			}
		}
	}

	// mark a given awaited file as being found
	#mark_found(/** @type {string | Filter} */ path) {
		if (this.#when_found.has(path)) {
			this.#when_found.get(path).resolve();
			this.#when_found.delete(path);
		}
	}
}

/**
 * @typedef {Object} DefilerData
 * @property {Transform} transform
 * @property {Generator[]} generators
 * @property {Resolver} resolver
 * @property {OnError} onerror
 */

/**
 * @typedef {Object} FileData
 * @property {string} path
 */

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
 * @typedef {Object} ExtraWatcherData
 * @property {boolean | ((arg: { path: string; stats: fs.Stats }) => Promise<boolean>)} read
 * @property {((arg: { path: string; stats: fs.Stats; bytes: Buffer }) => Promise<string>)} enc
 * @property {(data: FileData) => Promise<void>} pre
 *
 * @typedef {Watcher & ExtraWatcherData} WatcherData
 */

/**
 * @typedef {Object} WatcherEvent
 * @property {string} event
 * @property {string} path
 * @property {fs.Stats} stats
 */

/**
 * @typedef {Object} WhenFound
 * @property {Promise<void>} promise
 * @property {() => void} resolve
 * @property {Name[]} paths
 */
