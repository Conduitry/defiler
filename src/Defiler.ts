import { readFile } from './fs';
import { Stats } from 'fs';
import { resolve } from 'path';

import File from './File';
import Watcher, { WatcherEvent } from './Watcher';
import * as context from './context';

export default class Defiler {
	// set of original paths for all physical files
	paths = new Set<string>();
	// original paths -> original file data for all physical files ({ path, stats, bytes, enc })
	private _origData = new Map<string, FileData>();
	// original paths -> transformed files for all physical and virtual files
	files = new Map<string, File>();
	// Before, During, or After exec has been called
	private _status = Status.Before;
	// Watcher instances
	private _watchers: WatcherData[];
	// the transform to run on all files
	private _transform: Transform;
	// registered generators
	private _generators: Generator[];
	// (base, path) => path resolver function, used in defiler.get and defiler.add from transform
	private _resolver: Resolver;
	// handler to call when errors occur
	private _onerror: OnError;
	// original paths of all files currently undergoing transformation and symbols of all generators currently running
	private _active = new Set<Name>();
	// original paths -> { promise, resolve, paths } objects for when awaited files become available
	private _whenFound = new Map<string | Filter, WhenFound>();
	// array of [dependent, dependency] pairs, specifying changes to which files should trigger re-processing which other files
	private _deps: [Name, string | Filter][] = [];
	// queue of pending Watcher events to handle
	private _queue: [WatcherData, WatcherEvent][] = [];
	// whether some Watcher event is currently already in the process of being handled
	private _isProcessing = false;
	// end the current wave
	private _endWave: () => void = null;

	constructor(...args: any[]) {
		const { transform, generators = [], resolver, onerror } = <DefilerData>(
			args.pop()
		);
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
		this._watchers = args.map(
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
				dir = resolve(dir);
				return <WatcherData>(
					new Watcher({ dir, filter, read, enc, pre, watch, debounce })
				);
			},
		);
		this._transform = transform;
		this._generators = generators;
		this._resolver = resolver;
		this._onerror = onerror;
	}

	// execute everything, and return a promise that resolves when the first wave of processing is complete
	async exec(): Promise<void> {
		if (this._status !== Status.Before) {
			throw new Error('defiler.exec: cannot call more than once');
		}
		this._status = Status.During;
		this._isProcessing = true;
		const done = this._startWave();
		// init the Watcher instances
		const files: [WatcherData, string, { path: string; stats: Stats }][] = [];
		await Promise.all(
			this._watchers.map(async watcher => {
				watcher.on('', event => this._enqueue(watcher, event));
				// note that all files are pending transformation
				await Promise.all(
					(await watcher.init()).map(async file => {
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
			this._processPhysicalFile(watcher, path, file);
		}
		// process each generator
		for (const generator of this._generators) {
			this._processGenerator(generator);
		}
		// wait and finish up
		await done;
		this._status = Status.After;
		this._isProcessing = false;
		this._enqueue();
	}

	// wait for a file to be available and retrieve it, marking dependencies as appropriate
	async get(path: string): Promise<File>;
	async get(paths: string[]): Promise<File[]>;
	async get(filter: Filter): Promise<File[]>;
	async get(_: any): Promise<any> {
		if (typeof _ === 'string') {
			_ = this.resolve(_);
		}
		if (Array.isArray(_)) {
			return Promise.all(_.map(path => this.get(path)));
		}
		if (typeof _ !== 'string' && typeof _ !== 'function') {
			throw new TypeError(
				'defiler.get: argument must be a string, an array, or a function',
			);
		}
		const current = <Name>context.current();
		if (current) {
			this._deps.push([current, _]);
		}
		if (
			this._status === Status.During &&
			current &&
			(typeof _ === 'function' || !this.files.has(_))
		) {
			if (this._whenFound.has(_)) {
				const { promise, paths } = this._whenFound.get(_);
				paths.push(current);
				await promise;
			} else {
				let resolve;
				const promise = new Promise<void>(res => (resolve = res));
				this._whenFound.set(_, { promise, resolve, paths: [current] });
				await promise;
			}
		}
		return typeof _ === 'function'
			? this.get([...this.files.keys()].filter(_).sort())
			: this.files.get(_);
	}

	// add a new virtual file
	add(file: FileData): void {
		if (this._status === Status.Before) {
			throw new Error('defiler.add: cannot call before calling exec');
		}
		if (typeof file !== 'object') {
			throw new TypeError('defiler.add: file must be an object');
		}
		file.path = this.resolve(file.path);
		this._origData.set(file.path, file);
		this._processFile(file, 'add');
	}

	// resolve a given path from the file currently being transformed
	resolve(path: string): string {
		return this._resolver && typeof context.current() === 'string'
			? this._resolver(context.current(), path)
			: path;
	}

	// private methods

	// return a Promise that we will resolve at the end of this wave, and save its resolver
	private _startWave(): Promise<void> {
		return new Promise(res => (this._endWave = res));
	}

	// add a Watcher event to the queue, and handle queued events
	private async _enqueue(
		watcher?: WatcherData,
		event?: WatcherEvent,
	): Promise<void> {
		if (event) {
			this._queue.push([watcher, event]);
		}
		if (this._isProcessing) {
			return;
		}
		this._isProcessing = true;
		while (this._queue.length) {
			const done = this._startWave();
			const [watcher, { event, path, stats }] = this._queue.shift();
			const file = { path, stats };
			if (watcher.pre) {
				await watcher.pre(file);
			}
			if (event === '+') {
				this._processPhysicalFile(watcher, path, file);
			} else if (event === '-') {
				const { path } = file;
				const oldFile = this.files.get(path);
				this.paths.delete(path);
				this._origData.delete(path);
				this.files.delete(path);
				await this._callTransform(oldFile, 'delete');
				this._processDependents(path);
			}
			await done;
		}
		this._isProcessing = false;
	}

	// create a file object for a physical file and process it
	private async _processPhysicalFile(
		{ dir, read, enc }: WatcherData,
		path: string,
		file: FileData,
	): Promise<void> {
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
		this._origData.set(file.path, file);
		await this._processFile(file, 'read');
	}

	// transform a file, store it, and process dependents
	private async _processFile(data: FileData, event: string): Promise<void> {
		const file: File = Object.assign(new File(), data);
		const { path } = file;
		this._active.add(path);
		await this._callTransform(file, event);
		this.files.set(path, file);
		if (this._status === Status.During) {
			this._markFound(path);
		} else {
			this._processDependents(path);
		}
		this._active.delete(path);
		this._checkWave();
	}

	// call the transform on a file with the given event string, and handle errors
	private async _callTransform(file: File, event: string): Promise<void> {
		await null;
		context.create(file.path);
		try {
			await this._transform({ file, event });
		} catch (error) {
			if (this._onerror) {
				this._onerror({ file, event, error });
			}
		}
	}

	// run the generator given by the symbol
	private async _processGenerator(generator: Generator): Promise<void> {
		this._active.add(generator);
		await null;
		context.create(generator);
		try {
			await generator();
		} catch (error) {
			if (this._onerror) {
				this._onerror({ generator, error });
			}
		}
		this._active.delete(generator);
		this._checkWave();
	}

	// re-process all files that depend on a particular path
	private _processDependents(path: string): void {
		const dependents = new Set<Name>();
		for (const [dependent, dependency] of this._deps) {
			if (
				typeof dependency === 'string' ? dependency === path : dependency(path)
			) {
				dependents.add(dependent);
			}
		}
		this._deps = this._deps.filter(([dependent]) => !dependents.has(dependent));
		for (const dependent of dependents) {
			if (typeof dependent === 'function') {
				this._processGenerator(dependent);
			} else if (this._origData.has(dependent)) {
				this._processFile(this._origData.get(dependent), 'retransform');
			}
		}
		this._checkWave();
	}

	// check whether this wave is complete, and, if not, whether we need to break a deadlock
	private _checkWave(): void {
		if (!this._active.size) {
			this._endWave();
		} else if (this._status === Status.During) {
			const filterWaiting = new Set<Name>();
			const allWaiting = new Set<Name>();
			for (const [path, { paths }] of this._whenFound) {
				if (typeof path === 'function' || this._active.has(path)) {
					paths.forEach(path => filterWaiting.add(path));
				}
				paths.forEach(path => allWaiting.add(path));
			}
			if ([...this._active].every(path => filterWaiting.has(path))) {
				// all pending files are currently waiting for a filter or another pending file
				// break deadlock: assume all filters have found all they're going to find
				for (const path of this._whenFound.keys()) {
					if (typeof path === 'function') {
						this._markFound(path);
					}
				}
			} else if ([...this._active].every(path => allWaiting.has(path))) {
				// all pending files are currently waiting for one or more other files to exist
				// break deadlock: assume all files that have not appeared yet will never do so
				for (const path of this._whenFound.keys()) {
					if (typeof path === 'string' && !this._active.has(path)) {
						this._markFound(path);
					}
				}
			}
		}
	}

	// mark a given awaited file as being found
	private _markFound(path: string | Filter): void {
		if (this._whenFound.has(path)) {
			this._whenFound.get(path).resolve();
			this._whenFound.delete(path);
		}
	}
}

interface DefilerData {
	transform: Transform;
	generators?: Generator[];
	resolver?: Resolver;
	onerror?: OnError;
}

interface FileData {
	path: string;
	[propName: string]: any;
}

interface Filter {
	(path: string): boolean;
}

interface Generator {
	(): Promise<void>;
}

type Name = string | Generator;

interface OnError {
	(
		arg: {
			file?: any;
			event?: string;
			generator?: Generator;
			error: Error;
		},
	): void;
}

interface Resolver {
	(base: string, path: string): string;
}

const enum Status {
	Before,
	During,
	After,
}

interface Transform {
	(
		arg: {
			file: File;
			event: string;
		},
	): Promise<void>;
}

interface WatcherData extends Watcher {
	read: boolean | ((arg: { path: string; stats: Stats }) => Promise<boolean>);
	enc:
		| string
		| ((arg: { path: string; stats: Stats; bytes: Buffer }) => Promise<string>);
	pre: (data: FileData) => Promise<void>;
}

interface WhenFound {
	promise: Promise<void>;
	resolve: () => void;
	paths: Name[];
}
