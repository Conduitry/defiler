import * as path from 'path';
import * as typescript from 'typescript';

const { compilerOptions } = require('./tsconfig.json');

export default {
	input: './src/index.ts',
	external: name => /^[-_a-z]+$/.test(name),
	plugins: {
		resolveId: (importee, importer) => {
			if (importer && /^[./].*\/[^./]+$/.test(importee)) {
				return path.resolve(importer, '..', importee + '.ts');
			}
		},
		transform: (code, id) => {
			const result = typescript.transpileModule(code, { compilerOptions });
			return {
				code: result.outputText,
				map: result.sourceMapText && JSON.parse(result.sourceMapText),
			};
		},
	},
	output: [
		{
			file: './dist/index.cjs.js',
			format: 'cjs',
			sourcemap: true,
			interop: false,
		},
		{ file: './dist/index.es.js', format: 'es', sourcemap: true },
	],
};
