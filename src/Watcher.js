import EventEmitter from 'events'
import { stat, readdir } from './fs.js'
import { watch } from 'fs'

export default class Watcher extends EventEmitter {
	constructor(dir, watch) {
		super()
		this._dir = dir
		this._watch = watch

		this._dirs = new Set()
		this._files = new Map()

		this._timeouts = new Map()
		this._processing = false
		this._queue = []
	}

	async init() {
		await this._recurse(this._dir)
		return [...this._files.entries()].map(([path, stat]) => ({ path, stat }))
	}

	async _recurse(full) {
		let path = full.slice(this._dir.length + 1)
		let fileStat = await stat(full)
		if (fileStat.isFile()) {
			this._files.set(path, fileStat)
		} else if (fileStat.isDirectory()) {
			if (this._watch) {
				this._dirs.add(path)
				watch(full, (_, file) => {
					file = full + '/' + file
					if (this._timeouts.has(file)) clearTimeout(this._timeouts.get(file))
					this._timeouts.set(
						file,
						setTimeout(() => {
							this._timeouts.delete(file)
							this._enqueue(file)
						}, 50),
					)
				})
			}
			await Promise.all((await readdir(full)).map(sub => this._recurse(full + '/' + sub)))
		}
	}

	async _enqueue(full) {
		this._queue.push(full)
		if (this._processing) return
		this._processing = true
		while (this._queue.length) {
			full = this._queue.shift()
			let path = full.slice(this._dir.length + 1)
			try {
				let fileStat = await stat(full)
				if (fileStat.isFile()) {
					this._files.set(path, fileStat)
					this.emit('', { event: '+', path, stat: fileStat })
				} else if (fileStat.isDirectory() && !this._dirs.has(path)) {
					await this._recurse(full)
					for (let [newPath, fileStat] of this._files.entries()) {
						if (newPath.startsWith(path + '/')) {
							this.emit('', { event: '+', path: newPath, stat: fileStat })
						}
					}
				}
			} catch (e) {
				if (this._files.has(path)) {
					this._files.delete(path)
					this.emit('', { event: '-', path })
				} else if (this._dirs.has(path)) {
					this._dirs.delete(path)
					for (let old of this._files.keys()) {
						if (old.startsWith(path + '/')) {
							this._files.delete(old)
							this.emit('', { event: '-', path: old })
						}
					}
					for (let old of this._dirs.keys()) if (old.startsWith(path + '/')) this._dirs.delete(old)
				}
			}
		}
		this._processing = false
	}
}
