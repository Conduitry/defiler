import { EventEmitter } from 'events';
import * as fs from 'fs';

export default class Watcher extends EventEmitter {
	/** @type {string} */ dir;
	/** @type {(file: { path: string; stats: fs.Stats }) => boolean} */ filter;
	/** @type {boolean} */ watch;
	/** @type {number} */ debounce;
	// paths of all directories -> FSWatcher instances
	/** @type {Map<string, fs.FSWatcher>} */ #watchers = new Map();
	// paths of all files -> file stats
	/** @type {Map<string, fs.Stats>} */ #stats = new Map();
	// paths of files with pending debounced events -> setTimeout timer ids
	/** @type {Map<string, NodeJS.Timer>} */ #timeouts = new Map();
	// queue of pending FSWatcher events to handle
	/** @type {string[]} */ #queue = [];
	// whether some FSWatcher event is currently already in the process of being handled
	/** @type {boolean} */ #is_processing = false;

	constructor(/** @type {Object} */ data /* = { dir, filter, watch, debounce } */) {
		super();
		Object.assign(this, data);
	}

	// recurse directory, get stats, set up FSWatcher instances
	// returns array of { path, stats }
	async init() {
		await this.#recurse(this.dir);
		return [...this.#stats.entries()].map(([path, stats]) => ({ path, stats }));
	}

	// recurse a given directory
	async #recurse(/** @type {string} */ full) {
		const path = full.slice(this.dir.length + 1);
		const stats = await fs.promises.stat(full);
		if (this.filter && !(await this.filter({ path, stats }))) {
			return;
		}
		if (stats.isFile()) {
			this.#stats.set(path, stats);
		} else if (stats.isDirectory()) {
			if (this.watch) {
				this.#watchers.set(path, fs.watch(full, this.#handle.bind(this, full)));
			}
			await Promise.all((await fs.promises.readdir(full)).map((sub) => this.#recurse(full + '/' + sub)));
		}
	}

	// handle FSWatcher event for given directory
	#handle(/** @type {string} */ dir, /** @type {string} */ event, /** @type {string} */ file) {
		const full = dir + '/' + file;
		if (this.#timeouts.has(full)) {
			clearTimeout(this.#timeouts.get(full));
		}
		this.#timeouts.set(
			full,
			setTimeout(() => {
				this.#timeouts.delete(full);
				this.#enqueue(full);
			}, this.debounce),
		);
	}

	// add an FSWatcher event to the queue, and handle queued events
	async #enqueue(/** @type {string} */ full) {
		this.#queue.push(full);
		if (this.#is_processing) {
			return;
		}
		this.#is_processing = true;
		while (this.#queue.length) {
			const full = this.#queue.shift();
			const path = full.slice(this.dir.length + 1);
			try {
				const stats = await fs.promises.stat(full);
				if (this.filter && !(await this.filter({ path, stats }))) {
					continue;
				}
				if (stats.isFile()) {
					// note the new/changed file
					this.#stats.set(path, stats);
					this.emit('', { event: '+', path, stats });
				} else if (stats.isDirectory() && !this.#watchers.has(path)) {
					// note the new directory: start watching it, and report any files in it
					await this.#recurse(full);
					for (const [new_path, stats] of this.#stats.entries()) {
						if (new_path.startsWith(path + '/')) {
							this.emit('', { event: '+', path: new_path, stats });
						}
					}
				}
			} catch (e) {
				// probably this was a deleted file/directory
				if (this.#stats.has(path)) {
					// note the deleted file
					this.#stats.delete(path);
					this.emit('', { event: '-', path });
				} else if (this.#watchers.has(path)) {
					// note the deleted directory: stop watching it, and report any files that were in it
					for (const old of this.#watchers.keys()) {
						if (old === path || old.startsWith(path + '/')) {
							this.#watchers.get(old).close();
							this.#watchers.delete(old);
						}
					}
					for (const old of this.#stats.keys()) {
						if (old.startsWith(path + '/')) {
							this.#stats.delete(old);
							this.emit('', { event: '-', path: old });
						}
					}
				}
			}
		}
		this.#is_processing = false;
	}
}
