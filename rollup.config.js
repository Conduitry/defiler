export default {
	input: './src/index.js',
	external: name => /^[-_a-z]+$/.test(name),
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
