export default {
	entry: './src/index.js',
	external: name => /^[-a-z]+$/.test(name),
	interop: false,
	sourceMap: true,
	targets: [{ dest: './dist/index.cjs.js', format: 'cjs' }, { dest: './dist/index.es.js', format: 'es' }],
}
