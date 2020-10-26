# v2.0.1

- Make `pkg.engines.node` supported versions range more correct and strict

# v2.0.0

- Require Node 12.17+ for native `AsyncLocalStorage`
- Use `AsyncLocalStorage` for context tracking, rather than hacky custom solution
- Fix dependencies fetched during generators not being attached back to the generator

# v1.0.2

- Lazily enable async hook and disable it when possible

# v1.0.1

- Include TypeScript declaration file (`.d.ts`)

# v1.0.0

- Git tag is now the built version, for easier direct installation without the npm registry

# v0.18.1

- Defer resolving the `dir` passed to the `Defiler` constructor until `defiler.exec()` is called

# v0.18.0

- `defiler.get(filter)` now also returns virtual files in addition to physical ones

# v0.17.5

- Some fixes to resolving in `defiler.get`, and also allow the user-supplied resolver to return an array or a filter function

# v0.17.4

- New `defiler.get` feature: pass a filter function and retrieve all physical files whose paths match the filter (and make the transform/generator also re-run when physical files are created that match the filter)

# v0.17.3

- Fix a race condition where we might over-zealously break a non-existent deadlock because we haven't noticed yet that a file has become available

# v0.17.2

- Fix `file.filename` on top-level files

# v0.17.1

- Fix incorrect dependence relationships being made in certain cases

# v0.17.0

- Tidy API - no need to pass `defiler` instance to user code, as we are now actually tracking the asynchronous context in which `defiler.get` and `defiler.add` are called
- Rename `type` argument to the transform to the clearer `event`
- Require Node.js 8.2+ for the use of `async_hooks`

# v0.16.0

- Add `type` field to object passed to transform
- Add `onerror` handler callback option to `Defiler` constructor
- Removed emitted events from `Defiler` instance, as these are now handled more generally by `type` and `onerror`

# v0.15.3

- Add `defiler.resolve`, exposing path resolution via your `resolver`

# v0.15.2

- If file A's processing creates a virtual file B which depends on file C, then when file C changes, re-transform file B starting from what was originally created by file A

# v0.15.1

- Fix dependency tracking

# v0.15.0

- Allow multiple directories per Defiler instance, with per-directory `pre`-processing
- Other API tweaks, see docs

# v0.14.2

- Fix a regression which caused a wave to hang when a file was deleted or renamed

# v0.14.1

- Fix a race condition that can occur when generators finish after transforms in a given wave

# v0.14.0

- Allow per-file and per-directory filtering of which files to consider
- Allow `read` and `enc` settings to be determined per file
- Remove `file.paths`

# v0.13.5

- Support custom `resolver` option to `Defiler` to resolve paths passed to `defiler.get` and `defiler.add` from the transform

# v0.13.4

- Also wait for changes to settle if this wave was triggered by a file deletion

# v0.13.3

- Fix race condition when attempting to `defiler.get` a `File` that takes too long to process beyond the time it is waiting for its own dependencies

# v0.13.2

- If a file change event comes in during the first wave of processing, don't wait for another event after the first wave to trigger the second wave, and instead start it immediately upon finishing the first

# v0.13.1

- Fix `defiler.get` typechecking

# v0.13.0

- Remove concept of '`get` function' passed to transform and generators
- Add `defiler.get` method to replace it
- Fix a tricky dependency bug: If file or generator A added a virtual file B whose transformation depended on file C, make changing file C reprocess A, not B
- Remove `defiler.depend`, which was only exposed as a partial workaround for the above bug
- Remove non-useful `path` argument to `File` constructor

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
