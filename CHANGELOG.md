# v0.7.1

- Allow passing a POJO to `defiler.addFile` instead of a `File` instance

# v0.7.0

- Change several APIs to use objects as named parameters - see docs

# v0.6.2

- Do not include directories in `defiler.origFiles`/`defiler.files`/`defiler.origPaths`.

# v0.6.1

- Add second argument to transform and generator callbacks which is a convenience function calling `defiler.get` with the appropriate `dependent`.

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
