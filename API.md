The API consists of two classes, `File` and `Defiler`.

A `File` represents a physical file on the disk, or a generated virtual file with no particular corresponding file in the file system, or a partially or fully transformed physical or virtual/generated file.

A `Defiler` represents a set of watched files on the disk, plus a set of generated files, plus a set of transforms to execute on them.

# `File`

## Constructor

### `new File(path)`

A new `File` instance to serve as the representation of a physical file, a generated file, or a transformed file. `path` is the relative path to the file, from some understood root.

## Properties

### `path`

The file's path can be retrieved or updated by getting and setting `path`.

### `paths`

An array of all `path`s this file has had, in chronological order. Setting `path` automatically updates this.

### `ext`

The file's extension (including the preceding `.`) can be retrieved or updated by getting and setting `path`. The `ext` and `path` properties are kept in sync.

### `bytes`

The file's contents can be updated by getting or setting `bytes`, which is a `Buffer`.

### `text`

The file's contents can also be updated by getting or setting `text`, which is a string.

Mutating the `bytes` `Buffer` will not be reflected in `text`, but reassigning the entire `bytes` or `text` properties will keep the other in sync.

# `Defiler`

## Constructor

### `new Defiler()`

A new `Defiler` instance to represent a collection of watched physical files and generated files, and transforms to run on them.

## Properties

### `status`

The current status of the `Defiler`. This is `null` before `exec` has been called; `false` after `exec` has been called but before the initial wave of processing has completed; and `true` once the initial wave of processing is complete. It then remains unchanged as watched files are updated.

### `origFiles`

A map of (original) relative paths to `File` instances for the original physical files.

### `files`

A map of original relative paths to `File` instances for the transformed files.

### `origPaths`

A sorted array of the relative paths of all of the physical files. This can be used whether or not we've completed the initial wave of processing.

## Configuration

### `dir({ dir, read = true, watch = true, debounce = 10 }, ...)`

Register one or more input directories.

- `dir` - the directory to watch
- `read` - _(optional)_ whether to actually read in the contents of the files in this directory. If `false`, the files will still be run through all of the transforms, but they will have null `bytes` and `text`
- `watch` - _(optional)_ whether to actually watch this directory for changes. If `false`, the files will still be run through all of the transforms, but any changes to them will not be
- `debounce` - _(optional)_ The length of the timeout in milliseconds to use to debounce incoming events from `fs.watch`. Multiple events are often emitted for a single change, and events can also be emitted before `fs.stat` reports the changes. Defiler will wait until `debounce` milliseconds have passed since the last `fs.watch` event for a file before handling it. Defaults to 10ms, which Works On My Machine

Returns the `Defiler` instance for chaining.

### `transform(transform, ...)`

Register one or more new transforms to be applied to all files.

- `transform({ defiler, path, file, get })` - a transform function, which is passed an object containing the `Defiler` instance, the original `path` of the file, the `File` instance to mutate, and a function `get(path)` (see "The `get(path)` function" below). The transform function can return a `Promise` to indicate when it's done

Each file will have all transforms called on it, in the order that they were registered.

Returns the `Defiler` instance for chaining.

### `generator({ path: generator, ... })`

Register one or more new generated files, not directly sourced from a physical file.

- `path` - the relative path of the file to register the generator for
- `generator({ defiler, file, get })` - a generator function, which is passed an object containing the `Defiler` instance, a new `File` instance to mutate containing only a path, and a function `get(path)` (see "The `get(path)` function" below). The generator function can return a `Promise` to indicate when it's done

Returns the `Defiler` instance for chaining.

## Execution

### `exec()`

Start the Defiler running. No additional configuration (registering input directories, transforms, or generated files) can happen after this.

Returns a promise that resolves when the initial wave of processing is complete.

## Operation

### `file(file)`

Manually insert a non-physical `File`, running it through all the transforms.

For convenience, you can also call this with a plain old JavaScript object, and a new `File` instance will be created for you with fields `Object.assign`ed from the object.

Returns a `Promise` to indicate when all processing is complete.

### `depend(dependent, path)`

Register that `dependent` depends on `path`. When the file at `path` changes, the file at `dependent` will be automatically re-transformed Re-transforming a physical file will use the version of it that was last read into memory. Re-transforming a generated file will call its generator again.

## The `get(path)` function

Transforms and generators are both passed a `get` function. This waits for a file or array of files to be ready and retrieves the `File` instance(s).

- `path` - the path, or array of paths, to wait for to become available

Returns a `Promise` resolving to the `File` instance or an array of `File` instances.

This can be asked for physical, generated, or manually added files. If you ask for a file during the initial wave of processing before it is available, Defiler will wait for the file to be ready and transformed. If it ever happens that every in-progress file is waiting for a file to become available, the deadlock will be broken by Defiler resolving all of the pending `Promise`s to `undefined`. This may happen multiple times during the initial wave of processing.

This will also register the file being transformed/generated as depending on the file or files in `path`, using the `depend` method, above. Once the initial wave of processing is complete, any changes to dependencies will cause their dependents to be re-transformed/re-generated.

## Events

`Defiler` extends Node's `EventEmitter`, and emits four kinds of events.

### `origFile({ defiler, file })`

An `origFile` event is emitted when the original version of a physical file has been read in. It's emitted with an object containing the `Defiler` instance and the `File` instance.

### `file({ defiler, path, file })`

A `file` event is emitted after all transforms on a file are complete. It's emitted with an object containing the `Defiler` instance, the file's original relative `path`, and the fully transformed `File` instance.

### `deleted({ defiler, path })`

A `deleted` event is emitted when a watched physical file has been deleted. It's emitted with an object containing the `Defiler` instance and the (original) relative `path` to the file.

### `error({ defiler, path, file, error })`

An `error` event is emitted if a file transform or a file generator throws an exception or returns a `Promise` that rejects. It's emitted with an object containing the `Defiler` instance, the file's original relative `path`, the `File` instance that caused the error, and the thrown `error`.
