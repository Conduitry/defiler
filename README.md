# Defiler

[![npm version](https://img.shields.io/npm/v/defiler.svg?style=flat-square)](https://www.npmjs.com/package/defiler)

A small, strange building block.

## Motivation

Defiler is a small build tool framework with strange opinions. It was born out of a desire to redo the build process for my various personal websites. I wanted something that was very flexible, kept everything in memory as it was building, and could handle arbitrary dependencies between files so that when something changed, only the necessary files would be re-built.

## Concepts

Defiler's concept of a file is something that can come from one of two places: a physical file on the disk, or a virtual file that is generated by a callback you pass to Defiler. These two types of files differ slightly in how they are treated, but for the most part Defiler handles them both the same.

Files of both types are run through the gamut of transforms you register with Defiler. Each transform mutates the object representing the file in-place, and returns a promise indicating when it's finished.

Files' names can be changed as they're transformed, but the main way to refer to them will continue to be by their original path. This makes Defiler's job a bit easier, but is also probably more useful anyway. If you want to translate LESS into CSS and then inject it into a particular script, you're going to want to write `import './path/to/file.less'` not `import './path/to/file.css'`.

Files can be made to depend on other files, so that changes to a dependency cause the depender to be re-transformed. For physical files, the file does not need to be re-read from the disk before it can be re-transformed, as the original version is kept in memory.

Any transform or generator can also create additional files (which will then be run through all of the transforms). There's currently no way to make this additional file depend on any others for the purposes of automatic re-transformation, as the file would generally just be re-added when that transform or generator is run again.

Gaze is used as the underlying watcher for the simple reason that it provided an easy way to get a list of all of the currently watched files, so I didn't have to traverse the directory's initial contents at the start of the build.

If you need to write the transformed files to disk, that's its own transform. Just leave the file object untouched but write the file to disk in the appropriate location and return a promise indicating when you're done.

If you need some task management, that's outside the scope of this library. Just use `await` and `Promise.all`.

## Requirements

- [Node.js](https://nodejs.org/) 7.6+, as this code uses `async` / `await` extensively.
- [Gaze](https://www.npmjs.com/package/gaze)
- Insanity

## Documentation

- [api](https://github.com/Conduitry/defiler/blob/master/API.md#readme)
- [changelog](https://github.com/Conduitry/defiler/blob/master/CHANGELOG.md#readme)
- [todo](https://github.com/Conduitry/defiler/blob/master/TODO.md#readme)
- [homepage](https://defiler.unwieldy.org)

## License

Copyright (c) 2017 Conduitry

- [MIT](https://github.com/Conduitry/defiler/blob/master/LICENSE)
