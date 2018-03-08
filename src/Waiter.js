import symbols from './symbols.js'
let { _count, _resolve, _reject } = symbols

export default class Waiter {
	// initialize/reset, and set a promise property that can be awaited
	init() {
		this[_count] = 0
		this.promise = new Promise((res, rej) => {
			this[_resolve] = res
			this[_reject] = rej
		})
	}

	// add another promise that must be resolved before the main promise resolves
	add(promise) {
		this[_count]++
		promise.then(() => --this[_count] || this[_resolve](), this[_reject])
		return promise
	}
}
