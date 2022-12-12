import cheap_ts from 'rollup-plugin-cheap-ts';

export default {
	input: './src/index',
	external: (name) => /^[a-z]/.test(name),
	plugins: [cheap_ts()],
	output: [
		{
			file: './dist/index.cjs',
			format: 'cjs',
			sourcemap: true,
			interop: 'esModule',
			generatedCode: { constBindings: true },
		},
		{
			file: './dist/index.mjs',
			format: 'esm',
			sourcemap: true,
			generatedCode: { constBindings: true },
		},
	],
};
