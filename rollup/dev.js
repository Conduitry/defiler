import common from './common.js';
import { transpileModule } from 'typescript';
const tsconfig = require('../tsconfig.json');
common.plugins.transform = (code, id) => {
	if (id.endsWith('.ts')) {
		const { outputText, sourceMapText } = transpileModule(code, tsconfig);
		return { code: outputText, map: JSON.parse(sourceMapText) };
	}
};
export default common;
