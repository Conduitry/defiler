import EventEmitter from 'events'
import { stat, readdir } from './fs.js'
import { watch } from 'fs'

import symbols from './symbols.js'
let { _watchers, _stats, _timeouts, _queue, _isProcessing, _recurse, _handle, _enqueue } = symbols

export default class Watcher extends EventEmitter {
	constructor(data /* = { dir, watch, debounce } */) {
		super()
		Object.assign(this, data)
		this[_watchers] = new Map() // paths of all directories -> FSWatcher instances
		this[_stats] = new Map() // paths of all files -> file stats
		this[_timeouts] = new Map() // paths of files with pending debounced events -> setTimeout timer ids
		this[_queue] = [] // queue of pending FSWatcher events to handle
		this[_isProcessing] = false // whether some FSWatcher event is currently already in the process of being handled
	}

	// recurse directroy, get stats, set up FSWatcher instances
	// returns array of { path, stats }
	async init() {
		await this[_recurse](this.dir)
		return [...this[_stats].entries()].map(([path, stats]) => ({ path, stats }))
	}

	// recurse a given directory
	async [_recurse](full) {
		let path = full.slice(this.dir.length + 1)
		let stats = await stat(full)
		if (stats.isFile()) {
			this[_stats].set(path, stats)
		} else if (stats.isDirectory()) {
			if (this.watch) this[_watchers].set(path, watch(full, this[_handle].bind(this, full)))
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
			}, this.debounce),
		)
	}

	// add an FSWatcher event to the queue, and handle queued events
	async [_enqueue](full) {
		this[_queue].push(full)
		if (this[_isProcessing]) return
		this[_isProcessing] = true
		while (this[_queue].length) {
			let full = this[_queue].shift()
			let path = full.slice(this.dir.length + 1)
			try {
				let stats = await stat(full)
				if (stats.isFile()) {
					// note the new/changed file
					this[_stats].set(path, stats)
					this.emit('', { event: '+', path, stats })
				} else if (stats.isDirectory() && !this[_watchers].has(path)) {
					// note the new directory: start watching it, and report any files in it
					await this[_recurse](full)
					for (let [newPath, stats] of this[_stats].entries()) {
						if (newPath.startsWith(path + '/')) this.emit('', { event: '+', path: newPath, stats })
					}
				}
			} catch (e) {
				// probably this was a deleted file/directory
				if (this[_stats].has(path)) {
					// note the deleted file
					this[_stats].delete(path)
					this.emit('', { event: '-', path })
				} else if (this[_watchers].has(path)) {
					// note the deleted directory: stop watching it, and report any files that were in it
					for (let old of this[_watchers].keys()) {
						if (old === path || old.startsWith(path + '/')) {
							this[_watchers].get(old).close()
							this[_watchers].delete(old)
						}
					}
					for (let old of this[_stats].keys()) {
						if (old.startsWith(path + '/')) {
							this[_stats].delete(old)
							this.emit('', { event: '-', path: old })
						}
					}
				}
			}
		}
		this[_isProcessing] = false
	}
}
