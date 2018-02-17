import { readdir as readdir_, readFile as readFile_, stat as stat_ } from 'fs'
import { promisify } from 'util'

export let readdir = promisify(readdir_)
export let readFile = promisify(readFile_)
export let stat = promisify(stat_)
