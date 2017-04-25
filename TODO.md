# TODO

- figure out how to handle Gaze file change events that come in during the initial wave of processing
	- maybe save them to a queue and process them once we're done with the initial wave?
- during the initial wave, `defiler.origPaths` also contains generated files (because they're used as keys in `defiler._filePromises`), but then afterwards it only contains physical files. It should only ever contain physical files
