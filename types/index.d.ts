import * as fs from 'fs';

export class Defiler {
	paths: Set<string>;
	files: Map<string, File>;
	constructor(...args: any[]);
	exec(): Promise<void>;
	get(path: string): Promise<File>;
	get(paths: string[]): Promise<File[]>;
	get(filter: Filter): Promise<File[]>;
	add(file: FileData): void;
	resolve(path: string): string;
}

export class File {
	stats: fs.Stats;
	path: string;
	dir: string;
	filename: string;
	ext: string;
	enc: BufferEncoding;
	bytes: Buffer;
	text: string;
}

interface Filter {
	(path: string): boolean;
}

interface FileData {
	path: string;
	[propName: string]: any;
}
