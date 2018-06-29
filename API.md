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

The directory (not including the trailing slash) containing the file. For top-level files, this is an empty string.

### `filename`

The filename (including the extension) of the file.

### `ext`

The extension (including the preceding `.`) of the file. For extension-less files, this is an empty string.

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

### `new Defiler({ dir, filter, read = true, enc = 'utf8', pre, watch = true, debounce = 10 }, ..., { transform, generators, resolver, onerror })`

A new `Defiler` instance to represent a collection of physical files and virtual files, a transform to run on them, and additional generators. This constructor should be passed multiple arguments; all but the last one should be 'input configuration' objects, and the last should be an object containing `transform` and (optionally) `generators`, `resolver` and/or `onerror`.

- Input configuration
	- `dir` - a directory to watch
		- `filter({ path, stats })` - _(optional)_ a function to decide whether a given file or directory should be considered by Defiler. It's passed an object containing the file or directory's relative `path` and its `stats`. It should return `true` or `false` (or a `Promise` resolving to one of those). Returning `false` for a directory means that none of its contents will be included. You can use `stats.isFile()` and `stats.isDirectory()` to determine whether this is a file or a directory
	- `read` - _(optional)_ whether to actually read in the contents of the files in the directory. Defaults to `true`. If `false`, the files will still be run through the transform, but they will have null `bytes` and `text`
		- Can also be a function `read({ path, stats })`, which should return `true` or `false` (or a `Promise` resolving to one of those), allowing whether each file is read in to be decided individually
	- `enc` - _(optional)_ encoding to use for files read in from the directory. Defaults to `'utf8'`
		- Can also be a function `enc({ path, stats, bytes })`, which should return an encoding name (or a `Promise` resolving to one), allowing the encoding on each file to be decided individually
	- `pre(file)` - _(optional)_ a function to run some very basic pre-processing specific to this transform before the file continues on to the common transform. `file` is an object containing `path` and `stats`. You can change the `path` value (perhaps adding a prefix) and can also add further custom fields that will exist on the `file` when it is passed to the `transform`. (It is this potentially modified `path` that will be used in [`defiler.get`](#getpath).) This allows you to (among other things) determine which directory a file came from when transforming it. The pre-processing function can return a `Promise` to indicate when it's done
	- `watch` - _(optional)_ whether to actually watch the directory for changes. Defaults to `true`. If `false`, the files will still be run through the transform, but any changes to them will not be
		- `debounce` - _(optional)_ length of timeout in milliseconds to use to debounce incoming events from `fs.watch`. Defaults to 10. Multiple events are often emitted for a single change, and events can also be emitted before `fs.stat` reports the changes. Defiler will wait until `debounce` milliseconds have passed since the last `fs.watch` event for a file before handling it. The default of 10ms Works On My Machine
- Transform/generator/resolver configuration
	- `transform({ file, event })` - a transform function, which is passed an object containing the `File` instance to mutate and an `event` string indicating why this file is being run through the transform. This `event` can be `'read'` (indicating the file was just read in from the disk), `'add'` (indicating it was just manually added by calling [`defiler.add`](#addfile)), `'delete'` (indicating it's a file that was just deleted from the disk), or `'retransform'` (indicating the file is unchanged but is being re-transformed because one of its dependencies changed). The transform function can return a `Promise` to indicate when it's done
	- `generators` - _(optional)_ an array of generator functions, each of the form `generator()`. Each generator is called without arguments, and can return a `Promise` to indicate when it's done
	- `resolver(base, path)` - _(optional)_ a function that will be used to resolve the paths passed to `defiler.get` and `defiler.add` from the transform. This will be passed two arguments, `base` (the path of the file being transformed) and `path` (the path passed to `defiler.get`/`defiler.add`), and should return the resolved path to use
	- `onerror(error)` - _(optional)_ a function that will be called with an error object whenever an error occurs. See [Errors](#errors) below.

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

Wait for a file to be ready and retrieve the `File` instance.

- `path` - the path to wait for to become available and to then return

Returns a `Promise` resolving to the `File` instance.

This can be asked for a physical or virtual file. If you ask for a file during the initial wave of processing before it is available, Defiler will wait for the file to be ready and transformed. If it ever happens that every in-progress file is waiting for a file to become available, the deadlock will be broken by Defiler resolving all of the pending `File`s to `undefined`. This may happen multiple times during the initial wave of processing.

When used in your transform, this will also register the file being transformed as depending on the file at `path`. Once the initial wave of processing is complete, any changes to dependencies will cause their dependents to be re-transformed. When used in a generator, this will register the generator as depending on the file at `path`, and any changes to dependencies will cause the generator to be re-run.

### `get(paths)`

Wait for multiple files to be ready and retrieve the `File` instances.

- `paths` - the array of paths to wait for to become available and to then return

Returns a `Promise` resolving to an array of `File` instances.

### `get(filter)`

Wait for all files whose paths match a given filter function and retrieve the `File` instances.

- `filter(path)` - a function that will be passed a path and should return a boolean

Returns a `Promise` resolving to an array of matching `File` instances, sorted by their (original) paths.

This will return physical and virtual files. Once the initial wave of processing is complete, any new files matching the filter will also cause the generator or transform to be re-run.

### `add(file)`

Manually insert a virtual `File`, running it through the transform.

- `file` - the file data of the virtual file to add

The object does not need to be a `File` instance, and in fact there is no benefit to doing so. A new `File` instance is always created with properties `Object.assign`ed from `file`.

### `resolve(path)`

Resolves a path from the file being transformed, using your specified `resolver`.

- `path` - the path to resolve

Returns the resolved path.

If you did not specify a `resolver` or if you are currently in a generator, this will be `path` unchanged.

## Errors

The object passed to your `onerror` callback will be of two forms, depending on whether it is the result of an error thrown by the transform or an error thrown by a generator.

### Transform errors: `{ file, event, error }`

When an error occurs in the transform, `onerror` is called with an object containing the `File` instance that caused the error, the `event` that was passed to the transform, and the thrown `error`.

### Generator errors: `{ generator, error }`

When an error occurs in a generator, `onerror` is called with an object containing the `generator` function that threw the error and the thrown `error`.
