import { watch, stat as stat$1, readdir as readdir$1, readFile as readFile$1 } from 'fs';
import { resolve } from 'path';
import { promisify } from 'util';
import * as EventEmitter from 'events';
import { executionAsyncId, createHook } from 'async_hooks';

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
    set path(path) {
        if (typeof path !== 'string') {
            throw new TypeError('file.path must be a string');
        }
        if (this._path !== path) {
            this._path = path;
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

const readdir = promisify(readdir$1);
const stat = promisify(stat$1);
class Watcher extends EventEmitter {
    constructor(data) {
        super();
        this._watchers = new Map();
        this._stats = new Map();
        this._timeouts = new Map();
        this._queue = [];
        this._is_processing = false;
        Object.assign(this, data);
    }
    async init() {
        await this._recurse(this.dir);
        return [...this._stats.entries()].map(([path, stats]) => ({ path, stats }));
    }
    async _recurse(full) {
        const path = full.slice(this.dir.length + 1);
        const stats = await stat(full);
        if (this.filter && !(await this.filter({ path, stats }))) {
            return;
        }
        if (stats.isFile()) {
            this._stats.set(path, stats);
        }
        else if (stats.isDirectory()) {
            if (this.watch) {
                this._watchers.set(path, watch(full, this._handle.bind(this, full)));
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
        if (this._is_processing) {
            return;
        }
        this._is_processing = true;
        while (this._queue.length) {
            const full = this._queue.shift();
            const path = full.slice(this.dir.length + 1);
            try {
                const stats = await stat(full);
                if (this.filter && !(await this.filter({ path, stats }))) {
                    continue;
                }
                if (stats.isFile()) {
                    this._stats.set(path, stats);
                    this.emit('', { event: '+', path, stats });
                }
                else if (stats.isDirectory() && !this._watchers.has(path)) {
                    await this._recurse(full);
                    for (const [new_path, stats] of this._stats.entries()) {
                        if (new_path.startsWith(path + '/')) {
                            this.emit('', { event: '+', path: new_path, stats });
                        }
                    }
                }
            }
            catch (e) {
                if (this._stats.has(path)) {
                    this._stats.delete(path);
                    this.emit('', { event: '-', path });
                }
                else if (this._watchers.has(path)) {
                    for (const old of this._watchers.keys()) {
                        if (old === path || old.startsWith(path + '/')) {
                            this._watchers.get(old).close();
                            this._watchers.delete(old);
                        }
                    }
                    for (const old of this._stats.keys()) {
                        if (old.startsWith(path + '/')) {
                            this._stats.delete(old);
                            this.emit('', { event: '-', path: old });
                        }
                    }
                }
            }
        }
        this._is_processing = false;
    }
}

const contexts = new Map();
const hook = createHook({
    init: (id, _, trigger) => contexts.set(id, contexts.get(trigger)),
    destroy: id => contexts.delete(id),
});
let refs = 0;
const ref = () => {
    refs++ || hook.enable();
};
const unref = () => {
    --refs || hook.disable();
};
const create = (data) => {
    contexts.set(executionAsyncId(), data);
};
const current = () => contexts.get(executionAsyncId());

const readFile = promisify(readFile$1);
class Defiler {
    constructor(...args) {
        this.paths = new Set();
        this._orig_data = new Map();
        this.files = new Map();
        this._status = 0;
        this._active = new Set();
        this._when_found = new Map();
        this._deps = [];
        this._queue = [];
        this._is_processing = false;
        this._end_wave = null;
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
        ref();
        if (this._status !== 0) {
            throw new Error('defiler.exec: cannot call more than once');
        }
        this._status = 1;
        this._is_processing = true;
        const done = this._start_wave();
        const files = [];
        await Promise.all(this._watchers.map(async (watcher) => {
            watcher.dir = resolve(watcher.dir);
            watcher.on('', event => this._enqueue(watcher, event));
            await Promise.all((await watcher.init()).map(async (file) => {
                const { path } = file;
                if (watcher.pre) {
                    await watcher.pre(file);
                }
                this.paths.add(file.path);
                this._active.add(file.path);
                files.push([watcher, path, file]);
            }));
        }));
        for (const generator of this._generators) {
            this._active.add(generator);
        }
        for (const [watcher, path, file] of files) {
            this._process_physical_file(watcher, path, file);
        }
        for (const generator of this._generators) {
            this._process_generator(generator);
        }
        await done;
        this._status = 2;
        this._is_processing = false;
        if (this._watchers.some(watcher => watcher.watch)) {
            this._enqueue();
        }
        else {
            unref();
        }
    }
    async get(_) {
        if (typeof _ === 'string') {
            _ = this.resolve(_);
        }
        if (Array.isArray(_)) {
            return Promise.all(_.map(path => this.get(path)));
        }
        if (typeof _ !== 'string' && typeof _ !== 'function') {
            throw new TypeError('defiler.get: argument must be a string, an array, or a function');
        }
        const current$1 = current();
        if (current$1) {
            this._deps.push([current$1, _]);
        }
        if (this._status === 1 && current$1 && (typeof _ === 'function' || !this.files.has(_))) {
            if (this._when_found.has(_)) {
                const { promise, paths } = this._when_found.get(_);
                paths.push(current$1);
                await promise;
            }
            else {
                let resolve;
                const promise = new Promise(res => (resolve = res));
                this._when_found.set(_, { promise, resolve, paths: [current$1] });
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
        this._orig_data.set(file.path, file);
        this._process_file(file, 'add');
    }
    resolve(path) {
        return this._resolver && typeof current() === 'string' ? this._resolver(current(), path) : path;
    }
    _start_wave() {
        return new Promise(res => (this._end_wave = res));
    }
    async _enqueue(watcher, event) {
        if (event) {
            this._queue.push([watcher, event]);
        }
        if (this._is_processing) {
            return;
        }
        this._is_processing = true;
        while (this._queue.length) {
            const done = this._start_wave();
            const [watcher, { event, path, stats }] = this._queue.shift();
            const file = { path, stats };
            if (watcher.pre) {
                await watcher.pre(file);
            }
            if (event === '+') {
                this._process_physical_file(watcher, path, file);
            }
            else if (event === '-') {
                const { path } = file;
                const old_file = this.files.get(path);
                this.paths.delete(path);
                this._orig_data.delete(path);
                this.files.delete(path);
                await this._call_transform(old_file, 'delete');
                this._process_dependents(path);
            }
            await done;
        }
        this._is_processing = false;
    }
    async _process_physical_file({ dir, read, enc }, path, file) {
        if (typeof read === 'function') {
            read = await read({ path, stats: file.stats });
        }
        if (read) {
            file.bytes = await readFile(dir + '/' + path);
        }
        if (typeof enc === 'function') {
            enc = await enc({ path, stats: file.stats, bytes: file.bytes });
        }
        file.enc = enc;
        this.paths.add(file.path);
        this._orig_data.set(file.path, file);
        await this._process_file(file, 'read');
    }
    async _process_file(data, event) {
        const file = Object.assign(new File(), data);
        const { path } = file;
        this._active.add(path);
        await this._call_transform(file, event);
        this.files.set(path, file);
        if (this._status === 1) {
            this._mark_found(path);
        }
        else {
            this._process_dependents(path);
        }
        this._active.delete(path);
        this._check_wave();
    }
    async _call_transform(file, event) {
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
    async _process_generator(generator) {
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
        this._check_wave();
    }
    _process_dependents(path) {
        const dependents = new Set();
        for (const [dependent, dependency] of this._deps) {
            if (typeof dependency === 'string' ? dependency === path : dependency(path)) {
                dependents.add(dependent);
            }
        }
        this._deps = this._deps.filter(([dependent]) => !dependents.has(dependent));
        for (const dependent of dependents) {
            if (typeof dependent === 'function') {
                this._process_generator(dependent);
            }
            else if (this._orig_data.has(dependent)) {
                this._process_file(this._orig_data.get(dependent), 'retransform');
            }
        }
        this._check_wave();
    }
    _check_wave() {
        if (!this._active.size) {
            this._end_wave();
        }
        else if (this._status === 1) {
            const filter_waiting = new Set();
            const all_waiting = new Set();
            for (const [path, { paths }] of this._when_found) {
                if (typeof path === 'function' || this._active.has(path)) {
                    paths.forEach(path => filter_waiting.add(path));
                }
                paths.forEach(path => all_waiting.add(path));
            }
            if ([...this._active].every(path => filter_waiting.has(path))) {
                for (const path of this._when_found.keys()) {
                    if (typeof path === 'function') {
                        this._mark_found(path);
                    }
                }
            }
            else if ([...this._active].every(path => all_waiting.has(path))) {
                for (const path of this._when_found.keys()) {
                    if (typeof path === 'string' && !this._active.has(path)) {
                        this._mark_found(path);
                    }
                }
            }
        }
    }
    _mark_found(path) {
        if (this._when_found.has(path)) {
            this._when_found.get(path).resolve();
            this._when_found.delete(path);
        }
    }
}

export { Defiler, File };
//# sourceMappingURL=index.esm.js.map
