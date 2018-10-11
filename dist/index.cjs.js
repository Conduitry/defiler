'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var EventEmitter = require('events');
var fs = require('fs');
var util = require('util');
var async_hooks = require('async_hooks');
var path = require('path');

class File {
    constructor() {
        this._path = null;
        this._dir = null;
        this._filename = null;
        this._ext = null;
        this.stats = null;
        this._enc = 'utf8';
        this._bytes = null;
        this._text = null;
    }
    get path() {
        return this._path;
    }
    set path(path$$1) {
        if (typeof path$$1 !== 'string') {
            throw new TypeError('file.path must be a string');
        }
        if (this._path !== path$$1) {
            this._path = path$$1;
            this._dir = this._filename = this._ext = null;
        }
    }
    get dir() {
        if (this._dir == null) {
            const p = this._path.lastIndexOf('/');
            this._dir = p > -1 ? this._path.slice(0, p) : '';
        }
        return this._dir;
    }
    set dir(dir) {
        if (typeof dir !== 'string') {
            throw new TypeError('file.dir must be a string');
        }
        this.path = (dir ? dir + '/' : '') + this.filename;
    }
    get filename() {
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
    get ext() {
        if (this._ext == null) {
            const p1 = this._path.lastIndexOf('.');
            const p2 = this._path.lastIndexOf('/');
            this._ext = p1 > -1 && p1 > p2 ? this._path.slice(p1) : '';
        }
        return this._ext;
    }
    set ext(ext) {
        if (typeof ext !== 'string') {
            throw new TypeError('file.ext must be a string');
        }
        const old = this.ext;
        this.path = (old ? this._path.slice(0, -old.length) : this._path) + ext;
    }
    get enc() {
        return this._enc;
    }
    set enc(enc) {
        if (!Buffer.isEncoding(enc)) {
            throw new TypeError('file.enc must be a supported encoding');
        }
        this._enc = enc;
    }
    get bytes() {
        return this._bytes == null && this._text != null ? (this._bytes = Buffer.from(this._text, this._enc)) : this._bytes;
    }
    set bytes(bytes) {
        if (bytes != null && !Buffer.isBuffer(bytes)) {
            throw new TypeError('file.bytes must be a Buffer or null');
        }
        this._bytes = bytes;
        this._text = null;
    }
    get text() {
        return this._text == null && this._bytes != null ? (this._text = this._bytes.toString(this._enc)) : this._text;
    }
    set text(text) {
        if (text != null && typeof text !== 'string') {
            throw new TypeError('file.text must be a string or null');
        }
        this._text = text;
        this._bytes = null;
    }
}

const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);
class Watcher extends EventEmitter {
    constructor(data) {
        super();
        this._watchers = new Map();
        this._stats = new Map();
        this._timeouts = new Map();
        this._queue = [];
        this._isProcessing = false;
        Object.assign(this, data);
    }
    async init() {
        await this._recurse(this.dir);
        return [...this._stats.entries()].map(([path$$1, stats]) => ({
            path: path$$1,
            stats,
        }));
    }
    async _recurse(full) {
        const path$$1 = full.slice(this.dir.length + 1);
        const stats = await stat(full);
        if (this.filter && !(await this.filter({ path: path$$1, stats }))) {
            return;
        }
        if (stats.isFile()) {
            this._stats.set(path$$1, stats);
        }
        else if (stats.isDirectory()) {
            if (this.watch) {
                this._watchers.set(path$$1, fs.watch(full, this._handle.bind(this, full)));
            }
            await Promise.all((await readdir(full)).map(sub => this._recurse(full + '/' + sub)));
        }
    }
    _handle(dir, event, file) {
        const full = dir + '/' + file;
        if (this._timeouts.has(full)) {
            clearTimeout(this._timeouts.get(full));
        }
        this._timeouts.set(full, setTimeout(() => {
            this._timeouts.delete(full);
            this._enqueue(full);
        }, this.debounce));
    }
    async _enqueue(full) {
        this._queue.push(full);
        if (this._isProcessing) {
            return;
        }
        this._isProcessing = true;
        while (this._queue.length) {
            const full = this._queue.shift();
            const path$$1 = full.slice(this.dir.length + 1);
            try {
                const stats = await stat(full);
                if (this.filter && !(await this.filter({ path: path$$1, stats }))) {
                    continue;
                }
                if (stats.isFile()) {
                    this._stats.set(path$$1, stats);
                    this.emit('', { event: '+', path: path$$1, stats });
                }
                else if (stats.isDirectory() && !this._watchers.has(path$$1)) {
                    await this._recurse(full);
                    for (const [newPath, stats] of this._stats.entries()) {
                        if (newPath.startsWith(path$$1 + '/')) {
                            this.emit('', { event: '+', path: newPath, stats });
                        }
                    }
                }
            }
            catch (e) {
                if (this._stats.has(path$$1)) {
                    this._stats.delete(path$$1);
                    this.emit('', { event: '-', path: path$$1 });
                }
                else if (this._watchers.has(path$$1)) {
                    for (const old of this._watchers.keys()) {
                        if (old === path$$1 || old.startsWith(path$$1 + '/')) {
                            this._watchers.get(old).close();
                            this._watchers.delete(old);
                        }
                    }
                    for (const old of this._stats.keys()) {
                        if (old.startsWith(path$$1 + '/')) {
                            this._stats.delete(old);
                            this.emit('', { event: '-', path: old });
                        }
                    }
                }
            }
        }
        this._isProcessing = false;
    }
}

const contexts = new Map();
async_hooks.createHook({
    init: (id, _, trigger) => contexts.set(id, contexts.get(trigger)),
    destroy: id => contexts.delete(id),
}).enable();
const create = (data) => {
    contexts.set(async_hooks.executionAsyncId(), data);
};
const current = () => contexts.get(async_hooks.executionAsyncId());

const readFile = util.promisify(fs.readFile);
class Defiler {
    constructor(...args) {
        this.paths = new Set();
        this._origData = new Map();
        this.files = new Map();
        this._status = 0;
        this._active = new Set();
        this._whenFound = new Map();
        this._deps = [];
        this._queue = [];
        this._isProcessing = false;
        this._endWave = null;
        const { transform, generators = [], resolver, onerror } = args.pop();
        if (typeof transform !== 'function') {
            throw new TypeError('defiler: transform must be a function');
        }
        if (!Array.isArray(generators) || generators.some(generator => typeof generator !== 'function')) {
            throw new TypeError('defiler: generators must be an array of functions');
        }
        if (resolver && typeof resolver !== 'function') {
            throw new TypeError('defiler: resolver must be a function');
        }
        if (onerror && typeof onerror !== 'function') {
            throw new TypeError('defiler: onerror must be a function');
        }
        this._watchers = args.map(({ dir, filter, read = true, enc = 'utf8', pre, watch = true, debounce = 10 }) => {
            if (typeof dir !== 'string') {
                throw new TypeError('defiler: dir must be a string');
            }
            if (filter && typeof filter !== 'function') {
                throw new TypeError('defiler: filter must be a function');
            }
            if (typeof read !== 'boolean' && typeof read !== 'function') {
                throw new TypeError('defiler: read must be a boolean or a function');
            }
            if (!Buffer.isEncoding(enc) && typeof enc !== 'function') {
                throw new TypeError('defiler: enc must be a supported encoding or a function');
            }
            if (pre && typeof pre !== 'function') {
                throw new TypeError('defiler: pre must be a function');
            }
            if (typeof watch !== 'boolean') {
                throw new TypeError('defiler: watch must be a boolean');
            }
            if (typeof debounce !== 'number') {
                throw new TypeError('defiler: debounce must be a number');
            }
            return new Watcher({ dir, filter, read, enc, pre, watch, debounce });
        });
        this._transform = transform;
        this._generators = generators;
        this._resolver = resolver;
        this._onerror = onerror;
    }
    async exec() {
        if (this._status !== 0) {
            throw new Error('defiler.exec: cannot call more than once');
        }
        this._status = 1;
        this._isProcessing = true;
        const done = this._startWave();
        const files = [];
        await Promise.all(this._watchers.map(async (watcher) => {
            watcher.dir = path.resolve(watcher.dir);
            watcher.on('', event => this._enqueue(watcher, event));
            await Promise.all((await watcher.init()).map(async (file) => {
                const { path: path$$1 } = file;
                if (watcher.pre) {
                    await watcher.pre(file);
                }
                this.paths.add(file.path);
                this._active.add(file.path);
                files.push([watcher, path$$1, file]);
            }));
        }));
        for (const generator of this._generators) {
            this._active.add(generator);
        }
        for (const [watcher, path$$1, file] of files) {
            this._processPhysicalFile(watcher, path$$1, file);
        }
        for (const generator of this._generators) {
            this._processGenerator(generator);
        }
        await done;
        this._status = 2;
        this._isProcessing = false;
        this._enqueue();
    }
    async get(_) {
        if (typeof _ === 'string') {
            _ = this.resolve(_);
        }
        if (Array.isArray(_)) {
            return Promise.all(_.map(path$$1 => this.get(path$$1)));
        }
        if (typeof _ !== 'string' && typeof _ !== 'function') {
            throw new TypeError('defiler.get: argument must be a string, an array, or a function');
        }
        const current$$1 = current();
        if (current$$1) {
            this._deps.push([current$$1, _]);
        }
        if (this._status === 1 && current$$1 && (typeof _ === 'function' || !this.files.has(_))) {
            if (this._whenFound.has(_)) {
                const { promise, paths } = this._whenFound.get(_);
                paths.push(current$$1);
                await promise;
            }
            else {
                let resolve;
                const promise = new Promise(res => (resolve = res));
                this._whenFound.set(_, { promise, resolve, paths: [current$$1] });
                await promise;
            }
        }
        return typeof _ === 'function' ? this.get([...this.files.keys()].filter(_).sort()) : this.files.get(_);
    }
    add(file) {
        if (this._status === 0) {
            throw new Error('defiler.add: cannot call before calling exec');
        }
        if (typeof file !== 'object') {
            throw new TypeError('defiler.add: file must be an object');
        }
        file.path = this.resolve(file.path);
        this._origData.set(file.path, file);
        this._processFile(file, 'add');
    }
    resolve(path$$1) {
        return this._resolver && typeof current() === 'string' ? this._resolver(current(), path$$1) : path$$1;
    }
    _startWave() {
        return new Promise(res => (this._endWave = res));
    }
    async _enqueue(watcher, event) {
        if (event) {
            this._queue.push([watcher, event]);
        }
        if (this._isProcessing) {
            return;
        }
        this._isProcessing = true;
        while (this._queue.length) {
            const done = this._startWave();
            const [watcher, { event, path: path$$1, stats }] = this._queue.shift();
            const file = { path: path$$1, stats };
            if (watcher.pre) {
                await watcher.pre(file);
            }
            if (event === '+') {
                this._processPhysicalFile(watcher, path$$1, file);
            }
            else if (event === '-') {
                const { path: path$$1 } = file;
                const oldFile = this.files.get(path$$1);
                this.paths.delete(path$$1);
                this._origData.delete(path$$1);
                this.files.delete(path$$1);
                await this._callTransform(oldFile, 'delete');
                this._processDependents(path$$1);
            }
            await done;
        }
        this._isProcessing = false;
    }
    async _processPhysicalFile({ dir, read, enc }, path$$1, file) {
        if (typeof read === 'function') {
            read = await read({ path: path$$1, stats: file.stats });
        }
        if (read) {
            file.bytes = await readFile(dir + '/' + path$$1);
        }
        if (typeof enc === 'function') {
            enc = await enc({ path: path$$1, stats: file.stats, bytes: file.bytes });
        }
        file.enc = enc;
        this.paths.add(file.path);
        this._origData.set(file.path, file);
        await this._processFile(file, 'read');
    }
    async _processFile(data, event) {
        const file = Object.assign(new File(), data);
        const { path: path$$1 } = file;
        this._active.add(path$$1);
        await this._callTransform(file, event);
        this.files.set(path$$1, file);
        if (this._status === 1) {
            this._markFound(path$$1);
        }
        else {
            this._processDependents(path$$1);
        }
        this._active.delete(path$$1);
        this._checkWave();
    }
    async _callTransform(file, event) {
        await null;
        create(file.path);
        try {
            await this._transform({ file, event });
        }
        catch (error) {
            if (this._onerror) {
                this._onerror({ file, event, error });
            }
        }
    }
    async _processGenerator(generator) {
        this._active.add(generator);
        await null;
        create(generator);
        try {
            await generator();
        }
        catch (error) {
            if (this._onerror) {
                this._onerror({ generator, error });
            }
        }
        this._active.delete(generator);
        this._checkWave();
    }
    _processDependents(path$$1) {
        const dependents = new Set();
        for (const [dependent, dependency] of this._deps) {
            if (typeof dependency === 'string' ? dependency === path$$1 : dependency(path$$1)) {
                dependents.add(dependent);
            }
        }
        this._deps = this._deps.filter(([dependent]) => !dependents.has(dependent));
        for (const dependent of dependents) {
            if (typeof dependent === 'function') {
                this._processGenerator(dependent);
            }
            else if (this._origData.has(dependent)) {
                this._processFile(this._origData.get(dependent), 'retransform');
            }
        }
        this._checkWave();
    }
    _checkWave() {
        if (!this._active.size) {
            this._endWave();
        }
        else if (this._status === 1) {
            const filterWaiting = new Set();
            const allWaiting = new Set();
            for (const [path$$1, { paths }] of this._whenFound) {
                if (typeof path$$1 === 'function' || this._active.has(path$$1)) {
                    paths.forEach(path$$1 => filterWaiting.add(path$$1));
                }
                paths.forEach(path$$1 => allWaiting.add(path$$1));
            }
            if ([...this._active].every(path$$1 => filterWaiting.has(path$$1))) {
                for (const path$$1 of this._whenFound.keys()) {
                    if (typeof path$$1 === 'function') {
                        this._markFound(path$$1);
                    }
                }
            }
            else if ([...this._active].every(path$$1 => allWaiting.has(path$$1))) {
                for (const path$$1 of this._whenFound.keys()) {
                    if (typeof path$$1 === 'string' && !this._active.has(path$$1)) {
                        this._markFound(path$$1);
                    }
                }
            }
        }
    }
    _markFound(path$$1) {
        if (this._whenFound.has(path$$1)) {
            this._whenFound.get(path$$1).resolve();
            this._whenFound.delete(path$$1);
        }
    }
}

exports.File = File;
exports.Defiler = Defiler;
//# sourceMappingURL=index.cjs.js.map
