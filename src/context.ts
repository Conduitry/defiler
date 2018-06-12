import { createHook, executionAsyncId } from 'async_hooks';

const contexts = new Map<Number, any>();

createHook({
	init: (id, _, trigger) => contexts.set(id, contexts.get(trigger)),
	destroy: id => contexts.delete(id),
}).enable();

export const create = (data: any): void => {
	contexts.set(executionAsyncId(), data);
};

export const current = (): any => contexts.get(executionAsyncId());
