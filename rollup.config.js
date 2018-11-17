import cheapTS from 'rollup-plugin-cheap-ts';

export default {
	input: './src/index',
	external: name => /^[a-z]/.test(name),
	plugins: [cheapTS()],
	output: [
		{
			file: './dist/index.cjs.js',
			format: 'cjs',
			sourcemap: true,
			interop: false,
		},
		{ file: './dist/index.esm.js', format: 'esm', sourcemap: true },
	],
};
