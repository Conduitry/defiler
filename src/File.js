import symbols from './symbols.js'
let { _path, _dir, _filename, _ext, _enc, _bytes, _text } = symbols

export default class File {
	constructor() {
		this[_path] = null // path of file
		this[_dir] = null // cached dir
		this[_filename] = null // cached filename
		this[_ext] = null // cached ext
		this.stats = null // stats of file
		this[_enc] = 'utf8' // encoding
		this[_bytes] = null // Buffer of file contents
		this[_text] = null // string of file contents
	}

	get path() {
		return this[_path]
	}

	set path(path) {
		if (typeof path !== 'string') throw new TypeError('file.path must be a string')
		if (this[_path] !== path) {
			this[_path] = path
			this[_dir] = this[_filename] = this[_ext] = null
		}
	}

	get dir() {
		if (this[_dir] == null) {
			let p = this[_path].lastIndexOf('/')
			this[_dir] = p > -1 ? this[_path].slice(0, p) : ''
		}
		return this[_dir]
	}

	set dir(dir) {
		if (typeof dir !== 'string') throw new TypeError('file.dir must be a string')
		this.path = (dir ? dir + '/' : '') + this.filename
	}

	get filename() {
		if (this[_filename] == null) {
			let p = this[_path].lastIndexOf('/')
			this[_filename] = p > -1 ? this[_path].slice(p + 1) : ''
		}
		return this[_filename]
	}

	set filename(filename) {
		if (typeof filename !== 'string') throw new TypeError('file.filename must be a string')
		let old = this.filename
		this.path = (old ? this[_path].slice(0, -old.length) : this[_path]) + filename
	}

	get ext() {
		if (this[_ext] == null) {
			let p1 = this[_path].lastIndexOf('.')
			let p2 = this[_path].lastIndexOf('/')
			this[_ext] = p1 > -1 && p1 > p2 ? this[_path].slice(p1) : ''
		}
		return this[_ext]
	}

	set ext(ext) {
		if (typeof ext !== 'string') throw new TypeError('file.ext must be a string')
		let old = this.ext
		this.path = (old ? this[_path].slice(0, -old.length) : this[_path]) + ext
	}

	get enc() {
		return this[_enc]
	}

	set enc(enc) {
		if (!Buffer.isEncoding(enc)) throw new TypeError('file.enc must be a supported encoding')
		this[_enc] = enc
	}

	get bytes() {
		return this[_bytes] == null && this[_text] != null
			? (this[_bytes] = Buffer.from(this[_text], this[_enc]))
			: this[_bytes]
	}

	set bytes(bytes) {
		if (!Buffer.isBuffer(bytes)) throw new TypeError('file.bytes must be a Buffer')
		this[_bytes] = bytes
		this[_text] = null
	}

	get text() {
		return this[_text] == null && this[_bytes] != null
			? (this[_text] = this[_bytes].toString(this[_enc]))
			: this[_text]
	}

	set text(text) {
		if (typeof text !== 'string') throw new TypeError('file.text must be a string')
		this[_text] = text
		this[_bytes] = null
	}
}
