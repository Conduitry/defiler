# v0.12.1

- Document `file.stats` (formerly `file.stat`, shhh)
- Wait for all `defiler.add`ed files to settle before proceeding with handling the next watch event
- Prevent mutations to `file.paths` from making their way back into the original copy of the `File`

# v0.12.0

- Simplify the API yet again - see docs
- Add new [guide](GUIDE.md#readme) to the docs
- Add more typechecking

# v0.11.2

- Add `file.dir` and `file.filename`, which also are kept in sync with `file.path`
- Add support for other encodings, via `file.enc` and the `enc` option when specifying an input directory

# v0.11.1

- Close `FSWatcher` instances when their directories are deleted

# v0.11.0

- Allow dependence on as-yet unknown files
- API adjustments - see docs

# v0.10.0

- Beautify `Defiler` API - see docs

# v0.9.3

- Add `file.paths`, an array of historical paths for the file
- Change default debounce timeout to 10ms

# v0.9.2

- Allow the `debounce` time for an input directory to be configured
- Normalize input directory names

# v0.9.1

- Fix a very embarrassing bug

# v0.9.0

- Switch from using Chokidar to an internal lightweight file watching system
- Remove concept of closing a `Defiler` instance and instead allow each configured input directory to specify whether it should be watched for changes - see API docs

# v0.8.1

- Make `defiler.ready` wait for any pending calls to `defiler.addFile` that have been called in the meantime

# v0.8.0

- Switch from using Gaze to Chokidar for the underlying file watching library

# v0.7.1

- Allow passing a POJO to `defiler.addFile` instead of a `File` instance

# v0.7.0

- Change several APIs to use objects as named parameters - see docs

# v0.6.2

- Do not include directories in `defiler.origFiles`/`defiler.files`/`defiler.origPaths`

# v0.6.1

- Add second argument to transform and generator callbacks which is a convenience function calling `defiler.get` with the appropriate `dependent`

# v0.6.0

- Add option to `defiler.exec` to automatically close Gazes after initial wave of processing
- Rename `defiler.use` to `defiler.get` and tidy its API - see docs

# v0.5.0

- Simplify if/else handling of conditional transforms - see API docs

# v0.4.1

- Re-process files when a dependency is deleted

# v0.4.0

- Include `origPath` as new first argument in `origFile`, `file`, and `error` events
- Fix dependency tracking for rebuilds when a dependency is renamed by a transform

# v0.3.0

- Change second argument of `defiler.use` into an object, in preparation for later features
- Combine various `defiler.add*` methods into one `defiler.add` method

# v0.2.0

- Send file changes through a queue, so we're only processing one at a time
- Don't lose changes that come in after Gazes are initialized but before first wave of processing is complete

# v0.1.2

- Fix entry URL for ES6 bundle

# v0.1.1

- Fix `defiler.origPaths` during initial wave of processing

# v0.1.0

- Actual initial version, after various pre-releases
