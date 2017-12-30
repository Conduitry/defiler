export default {
	input: './src/index.js',
	external: name => /^[-a-z]+$/.test(name),
	interop: false,
	output: [
		{ file: './dist/index.cjs.js', format: 'cjs', sourcemap: true },
		{ file: './dist/index.es.js', format: 'es', sourcemap: true },
	],
}
