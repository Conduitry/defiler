'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
let events = require("events");
let fs = require("fs");
let readFile$1 = fs.readFile;
let stat$1 = fs.stat;
function readFile$$1(...args) { return new Promise((res, rej) => readFile$1(...args, (err, val) => err ? rej(err) : res(val))) }
function stat$$1(...args) { return new Promise((res, rej) => stat$1(...args, (err, val) => err ? rej(err) : res(val))) }
let path = require("path");
let relative = path.relative;
let _bytes = Symbol();
let _text = Symbol();
class File {
	constructor(path) {
		this.path = path;
		this.stat = null;
		this[_bytes] = null;
		this[_text] = null;
	}
	get ext() {
		if (this.path && this.path.match) {
			let match = this.path.match(/\.[^./\\]+$/);
			if (match) {
				return match[0]
			}
		}
		return ''
	}
	set ext(ext) {
		let oldExt = this.ext;
		if (oldExt) {
			this.path = this.path.slice(0, -oldExt.length) + ext;
		} else {
			this.path += ext;
		}
	}
	get bytes() {
		if (this[_bytes] == null && this[_text] != null) {
			this[_bytes] = Buffer.from(this[_text]);
		}
		return this[_bytes]
	}
	set bytes(bytes) {
		this[_bytes] = bytes;
		this[_text] = null;
	}
	get text() {
		if (this[_text] == null && this[_bytes] != null) {
			this[_text] = this[_bytes].toString();
		}
		return this[_text]
	}
	set text(text) {
		this[_text] = text;
		this[_bytes] = null;
	}
}
let _files = Symbol();
let _defiles = Symbol();
let _ready = Symbol();
let _gazes = Symbol();
let _gazePromises = Symbol();
let _transforms = Symbol();
let _filePromises = Symbol();
let _customGenerators = Symbol();
let _dependencies = Symbol();
let _checkBeforeExec = Symbol();
let _checkAfterExec = Symbol();
let _processPhysicalFile = Symbol();
let _processFile = Symbol();
let _transformFile = Symbol();
let _handleGeneratedFile = Symbol();
let TRANSFORM = Symbol();
let IF = Symbol();
let ELSE = Symbol();
let END = Symbol();
class Defiler extends events {
	constructor() {
		super();
		this[_files] = new Map();
		this[_defiles] = new Map();
		this[_ready] = null;
		this[_gazes] = [];
		this[_gazePromises] = [];
		this[_transforms] = [];
		this[_filePromises] = new Map();
		this[_customGenerators] = new Map();
		this[_dependencies] = new Map();
	}
	// read-only getters
	get ready() {
		return this[_ready]
	}
	get files() {
		return this[_files]
	}
	get defiles() {
		return this[_defiles]
	}
	get paths() {
		return [ ...(this[_filePromises] || this[_files]).keys() ].sort()
	}
	// pre-exec (configuration) methods
	addGaze(gaze, rootPath, read = true) {
		this[_checkBeforeExec]('addGaze');
		this[_gazes].push({ gaze, rootPath, read });
		this[_gazePromises].push(new Promise(resolve => gaze.on('ready', resolve)));
		return this
	}
	addTransform(transform) {
		this[_checkBeforeExec]('addTransform');
		this[_transforms].push({ type: TRANSFORM, transform });
		return this
	}
	if(condition) {
		this[_checkBeforeExec]('if');
		this[_transforms].push({ type: IF, condition });
		return this
	}
	else() {
		this[_checkBeforeExec]('else');
		this[_transforms].push({ type: ELSE });
		return this
	}
	end() {
		this[_checkBeforeExec]('end');
		this[_transforms].push({ type: END });
		return this
	}
	addGeneratedFile(path, generator) {
		this[_checkBeforeExec]('addGeneratedFile');
		this[_customGenerators].set(path, generator);
		return this
	}
	// exec
	exec() {
		this[_checkBeforeExec]('exec');
		this[_ready] = new Promise(async resolve => {
			await Promise.all(this[_gazePromises]);
			this[_gazePromises] = null;
			let promises = [];
			for (let { gaze, rootPath, read } of this[_gazes]) {
				let watched = gaze.watched();
				for (let dir in watched) {
					for (let absolutePath of watched[dir]) {
						let promise = this[_processPhysicalFile](absolutePath, rootPath, read);
						promises.push(promise);
						this[_filePromises].set(_relativePath(rootPath, absolutePath), promise);
					}
				}
			}
			for (let path of this[_customGenerators].keys()) {
				let promise = this[_handleGeneratedFile](path);
				promises.push(promise);
				this[_filePromises].set(path, promise);
			}
			await Promise.all(promises);
			for (let { gaze, rootPath, read } of this[_gazes]) {
				gaze.on('all', (event, absolutePath) => {
					if (event === 'deleted') {
						let path = _relativePath(rootPath, absolutePath);
						this[_files].delete(path);
						this[_defiles].delete(path);
						this.emit('deleted', path);
					} else {
						this[_processPhysicalFile](absolutePath, rootPath, read);
					}
				});
			}
			this.on('defile', file => {
				let origins = new Set();
				for (let [ origin, deps ] of this[_dependencies].entries()) {
					if (deps.has(file.path)) {
						origins.add(origin);
						this[_dependencies].delete(origin);
					}
				}
				for (let originPath of origins) {
					this.refile(originPath);
				}
			});
			this[_filePromises] = null;
			resolve();
		});
		return this
	}
	// post-exec methods
	async use(path, origin) {
		this[_checkAfterExec]('use');
		if (Array.isArray(path)) {
			return Promise.all(path.map(path => this.use(path, origin)))
		}
		if (origin) {
			if (this[_dependencies].has(origin)) {
				this[_dependencies].get(origin).add(path);
			} else {
				this[_dependencies].set(origin, new Set([ path ]));
			}
		}
		if (this[_filePromises]) {
			await this[_filePromises].get(path);
		}
		return this[_defiles].get(path)
	}
	async refile(path) {
		this[_checkAfterExec]('refile');
		if (this[_customGenerators].has(path)) {
			await this[_handleGeneratedFile](path);
		} else if (this[_files].has(path)) {
			await this[_processFile](this[_files].get(path));
		}
	}
	async addFile(defile) {
		this[_checkAfterExec]('addFile');
		let { path } = defile;
		await this[_transformFile](defile);
		this[_defiles].set(path, defile);
		this.emit('defile', defile);
	}
	close() {
		this[_checkAfterExec]('close');
		for (let { gaze } of this[_gazes]) {
			gaze.close();
		}
	}
	// private methods
	[_checkBeforeExec](methodName) {
		if (this[_ready]) {
			throw new Error(`Cannot call ${methodName} after calling exec`)
		}
	}
	[_checkAfterExec](methodName) {
		if (!this[_ready]) {
			throw new Error(`Cannot call ${methodName} before calling exec`)
		}
	}
	async [_processPhysicalFile](absolutePath, rootPath, read) {
		let fileStat = await stat$$1(absolutePath);
		if (!fileStat.isFile()) {
			return
		}
		let path = _relativePath(rootPath, absolutePath);
		let file = new File(path);
		file.stat = fileStat;
		if (read) {
			file.bytes = await readFile$$1(absolutePath);
		}
		this[_files].set(path, file);
		this.emit('file', file);
		await this[_processFile](file);
	}
	async [_processFile](file) {
		let defile = new File(file.path);
		defile.stat = file.stat;
		defile.bytes = file.bytes;
		await this[_transformFile](defile);
		this[_defiles].set(file.path, defile);
		this.emit('defile', defile);
	}
	async [_transformFile](defile) {
		let depth = 0;
		let skipDepth = null;
		try {
			for (let { type, transform, condition } of this[_transforms]) {
				if (type === TRANSFORM) {
					if (skipDepth === null) {
						await transform.call(this, defile);
					}
				} else if (type === IF) {
					if (skipDepth === null && !condition.call(this, defile)) {
						skipDepth = depth;
					}
					depth++;
				} else if (type === ELSE) {
					if (skipDepth === null) {
						skipDepth = depth - 1;
					} else if (skipDepth === depth - 1) {
						skipDepth = null;
					}
				} else if (type === END) {
					depth--;
					if (skipDepth === depth) {
						skipDepth = null;
					}
				}
			}
		} catch (err) {
			this.emit('error', defile, err);
		}
	}
	async [_handleGeneratedFile](path) {
		try {
			let file = new File(path);
			await this[_customGenerators].get(path).call(this, file);
			await this.addFile(file);
		} catch (err) {
			this.emit('error', path, err);
		}
	}
}
function _relativePath(rootPath, absolutePath) {
	return relative(rootPath, absolutePath).replace(/\\/g, '/')
}
exports.Defiler = Defiler;
exports.File = File;
