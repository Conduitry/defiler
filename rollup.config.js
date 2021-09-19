export default {
	input: './src/index.js',
	external: name => /^[a-z]/.test(name),
	output: [
		{ file: './dist/index.cjs', format: 'cjs', sourcemap: true, interop: false, preferConst: true },
		{ file: './dist/index.mjs', format: 'esm', sourcemap: true, preferConst: true },
	],
};
