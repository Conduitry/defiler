const _path = Symbol();
const _dir = Symbol();
const _filename = Symbol();
const _ext = Symbol();
const _enc = Symbol();
const _bytes = Symbol();
const _text = Symbol();

export default class File {
	constructor() {
		// path of file
		this[_path] = null;
		// cached dir
		this[_dir] = null;
		// cached filename
		this[_filename] = null;
		// cached ext
		this[_ext] = null;
		// stats of file
		this.stats = null;
		// encoding
		this[_enc] = 'utf8';
		// Buffer of file contents
		this[_bytes] = null;
		// string of file contents
		this[_text] = null;
	}

	get path() {
		return this[_path];
	}

	set path(path) {
		if (typeof path !== 'string') {
			throw new TypeError('file.path must be a string');
		}
		if (this[_path] !== path) {
			this[_path] = path;
			this[_dir] = this[_filename] = this[_ext] = null;
		}
	}

	get dir() {
		if (this[_dir] == null) {
			const p = this[_path].lastIndexOf('/');
			this[_dir] = p > -1 ? this[_path].slice(0, p) : '';
		}
		return this[_dir];
	}

	set dir(dir) {
		if (typeof dir !== 'string') {
			throw new TypeError('file.dir must be a string');
		}
		this.path = (dir ? dir + '/' : '') + this.filename;
	}

	get filename() {
		if (this[_filename] == null) {
			const p = this[_path].lastIndexOf('/');
			this[_filename] = p > -1 ? this[_path].slice(p + 1) : '';
		}
		return this[_filename];
	}

	set filename(filename) {
		if (typeof filename !== 'string') {
			throw new TypeError('file.filename must be a string');
		}
		const old = this.filename;
		this.path =
			(old ? this[_path].slice(0, -old.length) : this[_path]) + filename;
	}

	get ext() {
		if (this[_ext] == null) {
			const p1 = this[_path].lastIndexOf('.');
			const p2 = this[_path].lastIndexOf('/');
			this[_ext] = p1 > -1 && p1 > p2 ? this[_path].slice(p1) : '';
		}
		return this[_ext];
	}

	set ext(ext) {
		if (typeof ext !== 'string') {
			throw new TypeError('file.ext must be a string');
		}
		const old = this.ext;
		this.path = (old ? this[_path].slice(0, -old.length) : this[_path]) + ext;
	}

	get enc() {
		return this[_enc];
	}

	set enc(enc) {
		if (!Buffer.isEncoding(enc)) {
			throw new TypeError('file.enc must be a supported encoding');
		}
		this[_enc] = enc;
	}

	get bytes() {
		return this[_bytes] == null && this[_text] != null
			? (this[_bytes] = Buffer.from(this[_text], this[_enc]))
			: this[_bytes];
	}

	set bytes(bytes) {
		if (bytes != null && !Buffer.isBuffer(bytes)) {
			throw new TypeError('file.bytes must be a Buffer or null');
		}
		this[_bytes] = bytes;
		this[_text] = null;
	}

	get text() {
		return this[_text] == null && this[_bytes] != null
			? (this[_text] = this[_bytes].toString(this[_enc]))
			: this[_text];
	}

	set text(text) {
		if (text != null && typeof text !== 'string') {
			throw new TypeError('file.text must be a string or null');
		}
		this[_text] = text;
		this[_bytes] = null;
	}
}
