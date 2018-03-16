The API consists of two classes, `File` and `Defiler`.

A `File` represents a physical file on the disk, or a virtual file with no particular corresponding file in the file system, or a partially or fully transformed physical or virtual file.

A `Defiler` represents a set of watched files on the disk, plus a set of virtual files, plus the operations to perform on them.

# `File`

## Constructor

### `new File()`

A new `File` instance to serve as the representation of a physical file, a virtual file, or a transformed file.

## Properties

### `path`

The relative path to the file, from some understood root. The path is always separated by forward slashes, regardless of platform. Updating `dir`, `filename`, or `ext` also updates this.

### `dir`

The directory (not including the trailing slash) containing the file.

### `filename`

The filename (including the extension) of the file.

### `ext`

The extension (including the preceding `.`) of the file.

### `stats`

The `fs.Stats` of the file.

### `bytes`

The file's contents can be retrieved and updated by getting or setting `bytes`, which is a `Buffer`.

Don't mutate this property. This causes various unwanted effects. Instead, assign it a new `Buffer` instance.

### `text`

The file's contents can also be retrieved and updated by getting or setting `text`, which is a string.

Reassigning the entire `bytes` or `text` properties will keep the other in sync.

### `enc`

The assumed encoding for the file. Defaults to `'utf8'`. Must be one of Node.js's supported encodings. Changing this in the middle of processing a file can cause confusing behavior, and is not recommended.

# `Defiler`

## Constructor

### `new Defiler({ dir, read = true, enc = 'utf8', watch = true, debounce = 10, transform, generators = [] })`

A new `Defiler` instance to represent a collection of physical files and virtual files, a transform to run on them, and additional generators.

- Directory configuration
	- `dir` - the directory to watch
	- `read` - _(optional)_ whether to actually read in the contents of the files in the directory. Defaults to `true`. If `false`, the files will still be run through the transform, but they will have null `bytes` and `text`
	- `enc` - _(optional)_ encoding to use for files read in from the directory. Defaults to `'utf8'`. This can also be changed for individual files (see [`file.enc`](#enc))
	- `watch` - _(optional)_ whether to actually watch the directory for changes. Defaults to `true`. If `false`, the files will still be run through the transform, but any changes to them will not be
	- `debounce` - _(optional)_ The length of the timeout in milliseconds to use to debounce incoming events from `fs.watch`. Defaults to 10. Multiple events are often emitted for a single change, and events can also be emitted before `fs.stat` reports the changes. Defiler will wait until `debounce` milliseconds have passed since the last `fs.watch` event for a file before handling it. The default of 10ms Works On My Machine
- Transform configuration
	- `transform({ defiler, file })` - a transform function, which is passed an object containing the `Defiler` instance and the `File` instance to mutate. The transform function can return a `Promise` to indicate when it's done
- Generator configuration
	- `generators` - _(optional)_ an array of generator functions, each of the form `generator({ defiler })`. Each generator is passed an object containing the `Defiler` instance. Each generator function can return a `Promise` to indicate when it's done
- Resolver configuration
	- `resolver(base, path)` - _(optional)_ a function that will be used to resolve the paths passed to `defiler.get` and `defiler.add` from the transform. This will be passed two arguments, `base` (the path of the file being transformed) and `path` (the path passed to `defiler.get`/`defiler.add`), and should return the resolved (original) path to look up

## Properties

### `paths`

A `Set` of the original relative paths of all of the physical files. (This does not include virtual files.) This will be available by the time your transform or generators are called, even if not all of the individual files have been read in yet.

### `files`

A `Map` of original relative paths to `File` instances for the transformed files. (This includes physical and virtual files.) During the initial wave of processing, this will only contain the files that are done being transformed.

## Methods

### `exec()`

Start the `Defiler` running.

Returns a `Promise` that resolves when the initial wave of processing is complete.

### `get(path)`

Wait for a file or array of files to be ready and retrieve the `File` instance(s).

- `path` - the path, or array of paths, to wait for to become available and to then return

Returns a `Promise` resolving to the `File` instance or an array of `File` instances.

This can be asked for physical or virtual files. If you ask for a file during the initial wave of processing before it is available, Defiler will wait for the file to be ready and transformed. If it ever happens that every in-progress file is waiting for a file to become available, the deadlock will be broken by Defiler resolving all of the pending `File`s to `undefined`. This may happen multiple times during the initial wave of processing.

When used in your transform, this will also register the file being transformed as depending on the file or files in `path`. Once the initial wave of processing is complete, any changes to dependencies will cause their dependents to be re-transformed. When used in a generator, this will register the generator as depending on the file or files in `path`, and any changes to dependencies will cause the generator to be re-run.

### `add(file)`

Manually insert a virtual `File`, running it through the transform.

- `file` - the `File` instance (or plain old JavaScript object) representing the virtual file to add

For convenience, you can call this with a POJO, and a new `File` instance will be created for you with properties `Object.assign`ed from the object.

## Events

`Defiler` extends Node's `EventEmitter`, and emits these events:

### `read({ defiler, file })`

A `read` event is emitted when the original version of a physical file has been read in. It's emitted with an object containing the `Defiler` instance and the `File` instance.

### `file({ defiler, file })`

A `file` event is emitted after a file has been transformed. It's emitted with an object containing the `Defiler` instance and the transformed `File` instance.

### `deleted({ defiler, file })`

A `deleted` event is emitted when a watched physical file has been deleted. It's emitted with an object containing the `Defiler` instance and the transformed version of the deleted `File`.

### `error({ defiler, file, error })`

An `error` event is emitted if the transform throws an exception or returns a `Promise` that rejects. It's emitted with an object containing the `Defiler` instance, the `File` instance that caused the error, and the thrown `error`.

### `error({ defiler, generator, error })`

An `error` event is also emitted if a generator throws an exception or returns a `Promise` that rejects. It's emitted with an object containing the `Defiler` instance, the `generator` function that threw the error, and the thrown `error`.
