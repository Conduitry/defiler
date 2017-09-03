export default {
	input: './src/index.js',
	external: name => /^[-a-z]+$/.test(name),
	interop: false,
	sourcemap: true,
	output: [
		{ file: './dist/index.cjs.js', format: 'cjs' },
		{ file: './dist/index.es.js', format: 'es' },
	],
}
