The API consists of two classes, `File` and `Defiler`.

A `File` represents a physical file on the disk, or a generated virtual file with no particular corresponding file in the filesystem, or a partially or fully transformed physical or virtual/generated file.

A `Defiler` represents a set of watched files on the disk, plus a set of generated files, plus a set of transforms to execute on them.

# `File`

## Constructor

### `new File(path)`

A new `File` instance to serve as the representation of a physical file, a generated file, or a transformed file. `path` is the relative path to the file, from some understood root.

## Properties

### `path`

The file's path can be retrieved or updated by getting and setting `path`.

### `ext`

The file's extension (including the preceding `.`) can be retrieved or updated by getting and setting `path`. The `ext` and `path` properties are kept in sync.

### `bytes`

The file's contents can be updated by getting or setting `bytes`, which is a `Buffer`.

### `text`

The file's contents can also be updated by getting of setting `text`, which is a string. Mutating the `bytes` `Buffer` will not be reflected in `text`, but reassigning the entire `bytes` or `text` properties will keep the other in sync.

# `Defiler`

## Constructor

### `new Defiler()`

A new `Defiler` instance to represent a collection of watched physical files and generated files, and transforms to run on them.

## Properties

### `ready`

A `Promise` that's resolved once we've completed the initial wave of processing. This remains unchanged as later watches or changes are triggered.

### `origFiles`

A map of (original) relative paths to `File` instances for the original physical files.

### `files`

A map of original relative paths to `File` instances for the transformed files.

### `origPaths`

A sorted array of the relative paths of all of the physical files. This can be used whether or not we've completed the initial wave of processing.

## Configuration

### `add({ chokidar, rootPath, read = true })`

Register a Chokidar watch.

- `chokidar` - the Chokidar watch
-	`rootPath` - the path that all of our paths should be relative to
- `read` - _(optional)_ whether to actually read in the contents of the files for this Chokidar watch. If `false`, the files will still be run through all of the transforms, but they will have null `bytes` and `text`

Returns the `Defiler` instance for chaining.

### `add({ transform, if })`

Register a new transform to be applied to all files.

- `transform({ defiler, path, file, get })` - a transformer function, which is passed an object containing the `Defiler` instance, the original `path` of the file, the `File` instance to mutate, and a function `get(path)` which calls the `get(path, dependent)` method (see below) with the appropriate `dependent` (that is, the current file's path), as a convenience. The function can return a `Promise` to indicate when it's done
- `if({ defiler, path, file })` - _(optional)_ a function that, if present, will be called (before calling the main `transform`) with an object containing the `Defiler` instance, the original `path` of the file, and the `File` instance. If the function returns `false` or a `Promise` resolving to `false`, the transform is skipped

Returns the `Defiler` instance for chaining.

### `add({ path, generator })`

Register a new generated file, not directly sourced from a physical file.

- `path` - the relative path of the file to register the generator for
- `generator({ defiler, file, get })` - a generator function, which is passed an object containing the `Defiler` instance, a new `File` instance to mutate containing only a path, and a function `get(path)` which calls the `get(path, dependent)` method (see below) with the appropriate `dependent` (that is, the current file's path), as a convenience. The function can return a `Promise` to indicate when it's done

Returns the `Defiler` instance for chaining.

## Execution

### `exec({ close = false })`

Start the Defiler running. No additional configuration (registering Chokidar watches, transforms, or generated files) can happen after this.

- `close` - _(optional)_ whether to immediately close all of the attached Chokidar watches after the initial wave of processing

Returns the `Defiler` instance for chaining.

## Operation

### `get(path, dependent)`

Wait for a file or array of files to be ready, and retrieve the `File` instance(s).

- `path` - the path, or array of paths, to wait for to become available
- `dependent` - _(optional)_ a path of a file to re-process if any of the file or files given in `path` change. Typically, this is the path to the file you are currently transforming or generating

Returns a `Promise` resolving to the `File` instance or an array of `File` instances.

This can be asked for physical or generated files. If you ask for one or more physical files during the initial wave of processing before everything has been read in and processed, it will wait for the file or files to be ready (and transformed). Requesting something that is neither a known physical file nor a registered generated file will not throw an error, but will instead simply return `undefined`.

If a path `dependent` is passed, `dependent` is registered as depending on the file or files in `path`. When the file or files in `path` change, the file at `dependent` will be automatically re-transformed (using `refile`, below). If you're calling `get` inside a transform or generator, `dependent` should typically be the path of the file you're transforming or generating.

Typically, you would not call this directly, and would instead call the `get` function passed to the transform or generator callback, which then calls this method with the appropriate `dependent`.

### `refile(path)`

Manually re-transform a `File`. This can be from a physical file or a generated one. Returns a `Promise` to indicate when all processing is complete. Re-transforming a physical file will use the version of it that was last read into memory. Re-transforming a generated file will call its generator again.

Returns a `Promise` to indicate when all processing is complete.

Typically, you would not need to call this directly, as it would be automatically handled by the dependencies registered by `get`.

### `addFile(file)`

Manually insert a non-physical `File`, running it through all the transforms.

For convenience, you can also call this with a plain old JavaScript object, and a new `File` instance will be created for you with fields `Object.assign`ed from the object.

Returns a `Promise` to indicate when all processing is complete.

### `close()`

Close all of the attached Chokidar watches.

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
