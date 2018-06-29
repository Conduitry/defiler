export default {
	input: './src/index',
	external: name => /^[a-z]/.test(name),
	plugins: {
		resolveId(importee, importer) {
			if (/\/[^.]+$/.test(importee)) {
				return this.resolveId(importee + '.ts', importer);
			}
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
