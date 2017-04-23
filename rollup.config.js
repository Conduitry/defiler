export default {
	entry: 'src/index.js',
	external: ['events', 'fs', 'path'],
	sourceMap: true,
	targets: [{ dest: 'dist/index.cjs.js', format: 'cjs' }, { dest: 'dist/index.es.js', format: 'es' }],
}
