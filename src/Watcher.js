import EventEmitter from 'events'
import { stat, readdir } from './fs.js'
import { watch } from 'fs'

import symbols from './symbols.js'
let {
	_dir,
	_watch,
	_debounce,
	_dirs,
	_files,
	_timeouts,
	_queue,
	_processing,
	_recurse,
	_handle,
	_enqueue,
} = symbols

export default class Watcher extends EventEmitter {
	constructor(dir, watch, debounce) {
		super()
		// directory to recursively watch the contents of
		this[_dir] = dir
		// whether to actually watch for changes (or just walk and retrieve contents and file stats)
		this[_watch] = watch
		// fs.watch event debounce, in milliseconds
		this[_debounce] = debounce
		// paths of all (recursive) directories -> FSWatcher instances
		this[_dirs] = new Map()
		// paths of all (recursive) files -> file stats
		this[_files] = new Map()
		// paths of (recursive) files with pending debounced events -> setTimeout timer ids
		this[_timeouts] = new Map()
		// queue of pending FSWatcher events to handle
		this[_queue] = []
		// whether some FSWatcher event is currently already in the process of being handled
		this[_processing] = false
	}

	// recurse directroy, get stats, set up FSWatcher instances
	// returns array of { file, stat }
	async init() {
		await this[_recurse](this[_dir])
		return [...this[_files].entries()].map(([path, stat]) => ({ path, stat }))
	}

	// recurse a given directory
	async [_recurse](full) {
		let path = full.slice(this[_dir].length + 1)
		let fileStat = await stat(full)
		if (fileStat.isFile()) {
			this[_files].set(path, fileStat)
		} else if (fileStat.isDirectory()) {
			if (this[_watch]) this[_dirs].set(path, watch(full, this[_handle].bind(this, full)))
			await Promise.all((await readdir(full)).map(sub => this[_recurse](full + '/' + sub)))
		}
	}

	// handle FSWatcher event for given directory
	[_handle](dir, event, file) {
		let full = dir + '/' + file
		if (this[_timeouts].has(full)) clearTimeout(this[_timeouts].get(full))
		this[_timeouts].set(
			full,
			setTimeout(() => {
				this[_timeouts].delete(full)
				this[_enqueue](full)
			}, this[_debounce]),
		)
	}

	// add an FSWatcher event to the queue, and handle queued events
	async [_enqueue](full) {
		this[_queue].push(full)
		if (this[_processing]) return
		this[_processing] = true
		while (this[_queue].length) {
			let full = this[_queue].shift()
			let path = full.slice(this[_dir].length + 1)
			try {
				let fileStat = await stat(full)
				if (fileStat.isFile()) {
					// note the new/changed file
					this[_files].set(path, fileStat)
					this.emit('', { event: '+', path, stat: fileStat })
				} else if (fileStat.isDirectory() && !this[_dirs].has(path)) {
					// note the new directory: start watching it, and report any files in it
					await this[_recurse](full)
					for (let [newPath, fileStat] of this[_files].entries()) {
						if (newPath.startsWith(path + '/')) {
							this.emit('', { event: '+', path: newPath, stat: fileStat })
						}
					}
				}
			} catch (e) {
				// probably this was a deleted file/directory
				if (this[_files].has(path)) {
					// note the deleted file
					this[_files].delete(path)
					this.emit('', { event: '-', path })
				} else if (this[_dirs].has(path)) {
					// note the deleted directory: stop watching it, and report any files that were in it
					for (let old of this[_dirs].keys()) {
						if (old === path || old.startsWith(path + '/')) {
							this[_dirs].get(old).close()
							this[_dirs].delete(old)
						}
					}
					for (let old of this[_files].keys()) {
						if (old.startsWith(path + '/')) {
							this[_files].delete(old)
							this.emit('', { event: '-', path: old })
						}
					}
				}
			}
		}
		this[_processing] = false
	}
}
