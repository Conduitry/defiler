export default class File {
	constructor(path) {
		this.path = path
		this.stat = null
		this._bytes = null
		this._text = null
	}

	get ext() {
		if (this.path && this.path.match) {
			let match = this.path.match(/\.[^./\\]+$/)
			if (match) {
				return match[0]
			}
		}
		return ''
	}

	set ext(ext) {
		let oldExt = this.ext
		if (oldExt) {
			this.path = this.path.slice(0, -oldExt.length) + ext
		} else {
			this.path += ext
		}
	}

	get bytes() {
		if (this._bytes == null && this._text != null) {
			this._bytes = Buffer.from(this._text)
		}
		return this._bytes
	}

	set bytes(bytes) {
		this._bytes = bytes
		this._text = null
	}

	get text() {
		if (this._text == null && this._bytes != null) {
			this._text = this._bytes.toString()
		}
		return this._text
	}

	set text(text) {
		this._text = text
		this._bytes = null
	}
}
