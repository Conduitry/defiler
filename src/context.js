import { createHook, executionAsyncId } from 'async_hooks';

const contexts = new Map();

createHook({
	init: (id, _, trigger) => contexts.set(id, contexts.get(trigger)),
	destroy: id => contexts.delete(id),
}).enable();

export const create = data => contexts.set(executionAsyncId(), data);

export const current = () => contexts.get(executionAsyncId());
