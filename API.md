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

A promise that's resolved once we've completed the initial wave of processing. This remains unchanged as later watches or changes are triggered.

### `origFiles`

A map of relative paths -> `File` instances for the original physical files.

### `files`

A map of (original) relative paths -> `File` instances for the transformed files.

### `origPaths`

A sorted array of the relative paths of all of the physical files. This can be used whether or not we've completed the initial wave of processing.

## Configuration

### `add({ gaze, rootPath, read = true })`

Register a Gaze instance.

- `gaze` - the Gaze instance
-	`rootPath` - the path that all of our paths should be relative to
- `read` - whether to actually read in the contents of the files for this Gaze. If `false`, the files will still be run through all of the transforms, but they will have null `bytes` and `text`

Returns the `Defiler` instance for chaining.

### `add({ transform })`

Register a new transform to be applied to all files.

- `transform(file)` - a transformer function, which is passed a `File` instance to mutate. In your function, `this` will be the current `Defiler` instance. The function should return a promise to indicate when it's done

Returns the `Defiler` instance for chaining.

### `if(condition)` / `else()` / `end()`

Allows conditionally skipping certain transforms in the pipe.

- `condition(file)` is passed the `File` instance.  In your function, `this` will be the current `Defiler` instance. The function should return `true` or `false`

Returns the `Defiler` instance for chaining.

This is used like: `defiler.if(file => someTest(file)).add({ transform: onlyIfTrue }).else().add({ transform: onlyIfFalse }).end()`.

### `add({ path, generator })`

Register a new generated file, not directly sourced from a physical file.

- `path` - the relative path of the file to register the generator for
- `generator(file)` - a function that is passed a new `File` instance containing only a path, which it should then mutate.  In your function, `this` will be the current `Defiler` instance. The function should return a promise to indicate when it's done

Returns the `Defiler` instance for chaining.

## Execution

### `exec()`

Starts the Defiler running. No additional configuration (registering Gazes, transforms, or generated files) can happen after this.

## Operation

### `use(path, { from })`

Waits for a file or array of files to be ready.

- `path` - The path or paths to wait for to become available.
- `from` - (optional) A path of a file to re-process if any of the file or files given in `path` change. (Typically, this is the path to the file you are currently transforming or generating.)

Returns a promise resolving to the `File` instance or an array of `File` instances.

This can be asked for physical or generated files. If you ask for one or more physical files during the initial wave of processing before everything has been read in and processed, it will wait for the file or files to be ready (and transformed). Asking for something that is neither a known physical file nor a registered generated file will not throw an error, but will instead simple return null.

If a path `origin` is passed, `origin` is registered as depending on the file or files in `path`. When the file or files in `path` change, the file at `origin` will be automatically re-transformed (using `refile`, below). If you're calling `use` inside a transform or generator, `origin` is typically going to be the path of the file you're transforming or generating.

### `refile(path)`

Manually re-transform a file. This can be from a physical file or a generated once. Returns a promise to indicate when all processing is complete. Re-transforming a physical file will use the version of it that was last read into memory. Re-transforming a generated file will call its generator again.

Returns a promise to indicate when all processing is complete.

Typically, you would not need to call this directly, as it would be automatically handled by the dependencies registered by `use`.

### `addFile(defile)`

Manually insert a non-physical file, running it through all the transforms.

Returns a promise to indicate when all processing is complete.

### `close()`

Close all of the attached Gazes.

## Events

`Defiler` extends Node's `EventEmitter`, and emits four events.

### `origFile(origPath, file)`

An `origFile` event is emitted when the original version of a physical file has been read in. It's emitted with two arguments: the file's original relative path and the `File` instance.

### `file(origPath, file)`

A `file` event is emitted after all transforms on a file are complete. It's emitted with two arguments: the file's original relative path and the fully transformed `File` instance.

### `deleted(origPath)`

A `deleted` event is emitted when a watched physical file has been deleted. It's emitted with one argument: the original relative path to the file.

### `error(origPath, file, err)`

An `error` event is emitted if a file transform or a file generator throws an exception or returns a promise that rejects. It's emitted with three arguments: the file's original relative path, the `File` instance that caused the error, and the thrown error.
