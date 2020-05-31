import cheap_ts from 'rollup-plugin-cheap-ts';

export default {
	input: './src/index',
	external: name => /^[a-z]/.test(name),
	plugins: [cheap_ts()],
	output: [
		{ file: 'dist/index.cjs.js', format: 'cjs', sourcemap: true, interop: false, preferConst: true },
		{ file: 'dist/index.esm.js', format: 'esm', sourcemap: true, preferConst: true },
	],
};
