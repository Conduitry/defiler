export default class File {
	constructor(path = '') {
		if (typeof path !== 'string') throw new TypeError('file.path must be a string')
		// path of file
		this._path = path
		// cached dir/filename/ext values
		this._dir = this._filename = this._ext = null
		// all historical paths of file
		this.paths = path ? [path] : []
		// stat of file
		this.stat = null
		// encoding
		this._enc = 'utf8'
		// Buffer of file contents
		this._bytes = null
		// string of file contents
		this._text = null
	}

	get path() {
		return this._path
	}

	set path(path) {
		if (typeof path !== 'string') throw new TypeError('file.path must be a string')
		if (this._path !== path) {
			this._path = path
			this._dir = this._filename = this._ext = null
			this.paths.push(path)
		}
	}

	get dir() {
		if (this._dir == null) this._dir = this._path.slice(0, -this.filename.length - 1)
		return this._dir
	}

	set dir(dir) {
		if (typeof dir !== 'string') throw new TypeError('file.dir must be a string')
		this.path = (dir ? dir + '/' : '') + this.filename
	}

	get filename() {
		if (this._filename == null) {
			let match = this._path.match(/[^/]+$/)
			this._filename = match ? match[0] : ''
		}
		return this._filename
	}

	set filename(filename) {
		if (typeof filename !== 'string') throw new TypeError('file.filename must be a string')
		let old = this.filename
		this.path = (old ? this._path.slice(0, -old.length) : this._path) + filename
	}

	get ext() {
		if (this._ext == null) {
			let match = this._path.match(/\.[^./\\]+$/)
			this._ext = match ? match[0] : ''
		}
		return this._ext
	}

	set ext(ext) {
		if (typeof ext !== 'string') throw new TypeError('file.ext must be a string')
		let old = this.ext
		this.path = (old ? this._path.slice(0, -old.length) : this._path) + ext
	}

	get enc() {
		return this._enc
	}

	set enc(enc) {
		if (!Buffer.isEncoding(enc)) throw new TypeError('file.enc must be a supported encoding')
		this._enc = enc
	}

	get bytes() {
		if (this._bytes == null && this._text != null) this._bytes = Buffer.from(this._text, this._enc)
		return this._bytes
	}

	set bytes(bytes) {
		if (!Buffer.isBuffer(bytes)) throw new TypeError('file.bytes must be a Buffer')
		this._bytes = bytes
		this._text = null
	}

	get text() {
		if (this._text == null && this._bytes != null) this._text = this._bytes.toString(this._enc)
		return this._text
	}

	set text(text) {
		if (typeof text !== 'string') throw new TypeError('file.text must be a string')
		this._text = text
		this._bytes = null
	}
}
