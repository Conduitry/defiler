import { EventEmitter } from 'events';
import * as fs from 'fs';

export default class Watcher extends EventEmitter {
	dir: string;
	filter: (file: { path: string; stats: fs.Stats }) => boolean;
	watch: boolean;
	debounce: number;
	// paths of all directories -> FSWatcher instances
	private _watchers = new Map<string, fs.FSWatcher>();
	// paths of all files -> file stats
	private _stats = new Map<string, fs.Stats>();
	// paths of files with pending debounced events -> setTimeout timer ids
	private _timeouts = new Map<string, NodeJS.Timer>();
	// queue of pending FSWatcher events to handle
	private _queue: string[] = [];
	// whether some FSWatcher event is currently already in the process of being handled
	private _is_processing: boolean = false;

	constructor(data: object /* = { dir, filter, watch, debounce } */) {
		super();
		Object.assign(this, data);
	}

	// recurse directory, get stats, set up FSWatcher instances
	// returns array of { path, stats }
	async init(): Promise<{ path: string; stats: fs.Stats }[]> {
		await this._recurse(this.dir);
		return [...this._stats.entries()].map(([path, stats]) => ({ path, stats }));
	}

	// recurse a given directory
	private async _recurse(full: string): Promise<void> {
		const path = full.slice(this.dir.length + 1);
		const stats = await fs.promises.stat(full);
		if (this.filter && !(await this.filter({ path, stats }))) {
			return;
		}
		if (stats.isFile()) {
			this._stats.set(path, stats);
		} else if (stats.isDirectory()) {
			if (this.watch) {
				this._watchers.set(path, fs.watch(full, this._handle.bind(this, full)));
			}
			await Promise.all((await fs.promises.readdir(full)).map((sub) => this._recurse(full + '/' + sub)));
		}
	}

	// handle FSWatcher event for given directory
	private _handle(dir: string, event: string, file: string): void {
		const full = dir + '/' + file;
		if (this._timeouts.has(full)) {
			clearTimeout(this._timeouts.get(full));
		}
		this._timeouts.set(
			full,
			setTimeout(() => {
				this._timeouts.delete(full);
				this._enqueue(full);
			}, this.debounce),
		);
	}

	// add an FSWatcher event to the queue, and handle queued events
	private async _enqueue(full: string): Promise<void> {
		this._queue.push(full);
		if (this._is_processing) {
			return;
		}
		this._is_processing = true;
		while (this._queue.length) {
			const full = this._queue.shift();
			const path = full.slice(this.dir.length + 1);
			try {
				const stats = await fs.promises.stat(full);
				if (this.filter && !(await this.filter({ path, stats }))) {
					continue;
				}
				if (stats.isFile()) {
					// note the new/changed file
					this._stats.set(path, stats);
					this.emit('', { event: '+', path, stats });
				} else if (stats.isDirectory() && !this._watchers.has(path)) {
					// note the new directory: start watching it, and report any files in it
					await this._recurse(full);
					for (const [new_path, stats] of this._stats.entries()) {
						if (new_path.startsWith(path + '/')) {
							this.emit('', { event: '+', path: new_path, stats });
						}
					}
				}
			} catch (e) {
				// probably this was a deleted file/directory
				if (this._stats.has(path)) {
					// note the deleted file
					this._stats.delete(path);
					this.emit('', { event: '-', path });
				} else if (this._watchers.has(path)) {
					// note the deleted directory: stop watching it, and report any files that were in it
					for (const old of this._watchers.keys()) {
						if (old === path || old.startsWith(path + '/')) {
							this._watchers.get(old).close();
							this._watchers.delete(old);
						}
					}
					for (const old of this._stats.keys()) {
						if (old.startsWith(path + '/')) {
							this._stats.delete(old);
							this.emit('', { event: '-', path: old });
						}
					}
				}
			}
		}
		this._is_processing = false;
	}
}

export interface WatcherEvent {
	event: string;
	path: string;
	stats?: fs.Stats;
}
