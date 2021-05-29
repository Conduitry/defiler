import * as fs from 'fs';

export default class File {
	// path of file
	/** @type {string} */ #path = null;
	// cached dir
	/** @type {string} */ #dir = null;
	// cached filename
	/** @type {string} */ #filename = null;
	// cached ext
	/** @type {string} */ #ext = null;
	// stats of file
	/** @type {fs.Stats} */ stats = null;
	// encoding
	/** @type {BufferEncoding} */ #enc = 'utf8';
	// Buffer of file contents
	/** @type {Buffer} */ #bytes = null;
	// string of file contents
	/** @type {string} */ #text = null;

	get path() {
		return this.#path;
	}

	set path(path) {
		if (typeof path !== 'string') {
			throw new TypeError('file.path must be a string');
		}
		if (this.#path !== path) {
			this.#path = path;
			this.#dir = this.#filename = this.#ext = null;
		}
	}

	get dir() {
		if (this.#dir == null) {
			const p = this.#path.lastIndexOf('/');
			this.#dir = p > -1 ? this.#path.slice(0, p) : '';
		}
		return this.#dir;
	}

	set dir(dir) {
		if (typeof dir !== 'string') {
			throw new TypeError('file.dir must be a string');
		}
		this.path = (dir ? dir + '/' : '') + this.filename;
	}

	get filename() {
		if (this.#filename == null) {
			const p = this.#path.lastIndexOf('/');
			this.#filename = p > -1 ? this.#path.slice(p + 1) : this.#path;
		}
		return this.#filename;
	}

	set filename(filename) {
		if (typeof filename !== 'string') {
			throw new TypeError('file.filename must be a string');
		}
		const old = this.filename;
		this.path = (old ? this.#path.slice(0, -old.length) : this.#path) + filename;
	}

	get ext() {
		if (this.#ext == null) {
			const p1 = this.#path.lastIndexOf('.');
			const p2 = this.#path.lastIndexOf('/');
			this.#ext = p1 > -1 && p1 > p2 ? this.#path.slice(p1) : '';
		}
		return this.#ext;
	}

	set ext(ext) {
		if (typeof ext !== 'string') {
			throw new TypeError('file.ext must be a string');
		}
		const old = this.ext;
		this.path = (old ? this.#path.slice(0, -old.length) : this.#path) + ext;
	}

	get enc() {
		return this.#enc;
	}

	set enc(enc) {
		if (!Buffer.isEncoding(enc)) {
			throw new TypeError('file.enc must be a supported encoding');
		}
		this.#enc = enc;
	}

	get bytes() {
		return this.#bytes == null && this.#text != null ? (this.#bytes = Buffer.from(this.#text, this.#enc)) : this.#bytes;
	}

	set bytes(bytes) {
		if (bytes != null && !Buffer.isBuffer(bytes)) {
			throw new TypeError('file.bytes must be a Buffer or null');
		}
		this.#bytes = bytes;
		this.#text = null;
	}

	get text() {
		return this.#text == null && this.#bytes != null ? (this.#text = this.#bytes.toString(this.#enc)) : this.#text;
	}

	set text(text) {
		if (text != null && typeof text !== 'string') {
			throw new TypeError('file.text must be a string or null');
		}
		this.#text = text;
		this.#bytes = null;
	}
}
