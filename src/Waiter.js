export default class Waiter {
	constructor() {
		this._done = false
		this._count = 0
		this.done = new Promise((res, rej) => {
			this._res = res
			this._rej = rej
		})
	}

	add(promise) {
		if (!this._done) {
			this._count++
			promise.then(
				() => {
					if (!--this._count) {
						this._done = true
						this._res()
					}
				},
				err => {
					this._done = true
					this._rej(err)
				}
			)
		}
		return promise
	}
}
