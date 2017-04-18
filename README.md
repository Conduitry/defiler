# Defiler

A small, strange building block.

## Motivation

Defiler is a small build tool framework with strange opinions. It was born out of a desire to redo the build process for my various personal websites. I wanted something that was very flexible, kept everything in memory as it was building, and could handle arbitrary dependencies between files so that when something changed, only the necessary files would be re-built.

## Concepts

XXX

## Requirements

- Node.js v7.6+, as this code uses `async`/`await` extensively.
- Insanity

## API

The API consists of two classes, `File` and `Defiler`.

XXX

### File

#### Constructor

##### `new File(path)`

A new `File` instance to serve as the representation of a physical file, a virtual file, or a transformed file. `path` is the relative path to the file, from some understood root.

#### Properties

##### `path`

The file's path can be retrieved or updated by getting and setting `path`.

##### `ext`

The file's extension (including the preceding `.`) can be retrieved or updated by getting and setting `path`. The `ext` and `path` properties are kept in sync.

##### `bytes`

The file's contents can be updated by getting or setting `bytes`, which is a `Buffer`.

##### `text`

The file's contents can also be updated by getting of setting `text`, which is a string. Mutating the `bytes` `Buffer` will not be reflected in `text`, but reassigning the entire `bytes` and `text` properties will keep the other in sync.

### Defiler

#### Constructor

##### `new Defiler()`

#### Properties

##### `ready`

A promise that's resolved once we've completed the initial wave of processing. This remains unchanged as later watches or changes are triggered.

##### `origFiles`

A map of relative paths -> `File` instances for the original physical files.

##### `files`

A map of relative paths -> `File` instances for the processed files.

##### `origPaths`

A sorted array of the relative paths of all of the physical files. This can be used whether or not we've completed the initial wave of processing.

#### Configuration

##### `addGaze(gaze, rootPath, read = true)`

Register a Gaze instance.

- `gaze` - the Gaze instance
-	`rootPath` - the path that all of our paths should be relative to
- `read` - whether to actually read in and processes the contents of the files for this Gaze

Returns the `Defiler` instance for chaining.

##### `addTransform(transform)`

Register a new transform to be applied to all files.

- `transform(file)` - a transformer function, which is passed a `File` instance to mutate. In your function, `this` will be the current `Defiler` instance. The function should return a promise to indicate when it's done

Returns the `Defiler` instance for chaining.

##### `if(condition)`

Allows conditionally skipping certain transforms in the pipe.

- `condition(file)` is passed the `File` instance.  In your function, `this` will be the current `Defiler` instance. The function should return `true` or `false`

Returns the `Defiler` instance for chaining.

##### `else()`

Allows conditionally skipping certain transforms in the pipe.

Returns the `Defiler` instance for chaining.

##### `end()`

Allows conditionally skipping certain transforms in the pipe.

Returns the `Defiler` instance for chaining.

##### `addGeneratedFile(path, generator)`

Register a new generated file, not directly sourced from a physical file.

- `path` - the relative path of the file to register the generator for
- `generator(file)` - a function that is passed a new `File` instance containing only a path, which it should then mutate.  In your function, `this` will be the current `Defiler` instance. The function should return a promise to indicate when it's done

Returns the Defiler instance for chaining.

#### Execution

##### `exec()`

Starts the Defiler running. No additional configuration (registering Gazes, transforms, or generated files) can happen after this.

#### Operation

##### `use(path, origin)`

Waits for a file or array of files to be ready.

- `path` - XXX
- `origin` - (optional) XXX

Returns a promise resolving to the File instance or an array of `File` instances.

If a path `origin` is passed, `origin` is registered as depending on the file or files in `path`. When the file or files in `path` change, the file at `origin` will be automatically re-transformed (using `refile`, below).

##### `refile(path)`

Manually re-transform a file. This can be from a physical file or a generated once. Returns a promise to indicate when all processing is complete. re-transforming a physical file will use the version of it that was last read into memory. Re-transforming a generated file will call its generator again.

Returns a promise to indicate when all processing is complete.

##### `addFile(defile)`

Manually insert a non-physical file, running it through all the transforms.

Returns a promise to indicate when all processing is complete.

##### `close()`

Close all of the attached Gazes.

#### Events

`Defiler` extends Node's `EventEmitter`, and emits three events.

XXX

## License

Copyright (c) 2017 Conduitry

MIT License
