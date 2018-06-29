import common from './common.js';
import { readFile, unlink } from 'fs';
import { promisify } from 'util';
common.plugins.transform = async (code, id) => {
	if (id.endsWith('.ts')) {
		id = id.slice(0, -2) + 'js';
		const [js, map] = await Promise.all(
			[id, id + '.map'].map(async path => {
				const data = await promisify(readFile)(path);
				unlink(path, () => null);
				return data.toString();
			}),
		);
		return { code: js, map: JSON.parse(map) };
	}
};
export default common;
