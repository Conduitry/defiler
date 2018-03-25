import * as fs from 'fs'
import { promisify } from 'util'

export let readdir = promisify(fs.readdir)
export let readFile = promisify(fs.readFile)
export let stat = promisify(fs.stat)
