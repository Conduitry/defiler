import * as fs from 'fs';

export default class File {
	// path of file
	private _path: string = null;
	// cached dir
	private _dir: string = null;
	// cached filename
	private _filename: string = null;
	// cached ext
	private _ext: string = null;
	// stats of file
	stats: fs.Stats = null;
	// encoding
	private _enc: BufferEncoding = 'utf8';
	// Buffer of file contents
	private _bytes: Buffer = null;
	// string of file contents
	private _text: string = null;

	get path(): string {
		return this._path;
	}

	set path(path: string) {
		if (typeof path !== 'string') {
			throw new TypeError('file.path must be a string');
		}
		if (this._path !== path) {
			this._path = path;
			this._dir = this._filename = this._ext = null;
		}
	}

	get dir(): string {
		if (this._dir == null) {
			const p = this._path.lastIndexOf('/');
			this._dir = p > -1 ? this._path.slice(0, p) : '';
		}
		return this._dir;
	}

	set dir(dir: string) {
		if (typeof dir !== 'string') {
			throw new TypeError('file.dir must be a string');
		}
		this.path = (dir ? dir + '/' : '') + this.filename;
	}

	get filename(): string {
		if (this._filename == null) {
			const p = this._path.lastIndexOf('/');
			this._filename = p > -1 ? this._path.slice(p + 1) : this._path;
		}
		return this._filename;
	}

	set filename(filename) {
		if (typeof filename !== 'string') {
			throw new TypeError('file.filename must be a string');
		}
		const old = this.filename;
		this.path = (old ? this._path.slice(0, -old.length) : this._path) + filename;
	}

	get ext(): string {
		if (this._ext == null) {
			const p1 = this._path.lastIndexOf('.');
			const p2 = this._path.lastIndexOf('/');
			this._ext = p1 > -1 && p1 > p2 ? this._path.slice(p1) : '';
		}
		return this._ext;
	}

	set ext(ext: string) {
		if (typeof ext !== 'string') {
			throw new TypeError('file.ext must be a string');
		}
		const old = this.ext;
		this.path = (old ? this._path.slice(0, -old.length) : this._path) + ext;
	}

	get enc(): BufferEncoding {
		return this._enc;
	}

	set enc(enc: BufferEncoding) {
		if (!Buffer.isEncoding(enc)) {
			throw new TypeError('file.enc must be a supported encoding');
		}
		this._enc = enc;
	}

	get bytes(): Buffer {
		return this._bytes == null && this._text != null ? (this._bytes = Buffer.from(this._text, this._enc)) : this._bytes;
	}

	set bytes(bytes: Buffer) {
		if (bytes != null && !Buffer.isBuffer(bytes)) {
			throw new TypeError('file.bytes must be a Buffer or null');
		}
		this._bytes = bytes;
		this._text = null;
	}

	get text(): string {
		return this._text == null && this._bytes != null ? (this._text = this._bytes.toString(this._enc)) : this._text;
	}

	set text(text: string) {
		if (text != null && typeof text !== 'string') {
			throw new TypeError('file.text must be a string or null');
		}
		this._text = text;
		this._bytes = null;
	}
}
