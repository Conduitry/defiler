# v0.4.0

- Include `origPath` as new first argument in `origFile`, `file`, and `error` events
- Fix dependency tracking for rebuilds when a dependency is renamed by a transform

# v0.3.0

- Change second argument of `defiler.use` into an object, in preparation for later features
- combine various `defiler.add*` methods into one `defiler.add` method

# v0.2.0

- Send file changes through a queue, so we're only processing one at a time
- Don't lose changes that come in after Gazes are initialized but before first wave of processing is complete

# v0.1.2

- Fix entry URL for ES6 bundle

# v0.1.1

- Fix `defiler.origPaths` during initial wave of processing

# v0.1.0

- Actual initial version, after various pre-releases
