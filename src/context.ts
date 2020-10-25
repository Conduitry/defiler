import { createHook, executionAsyncId } from 'async_hooks';

const contexts = new Map<Number, any>();

const hook = createHook({
	init: (id, _, trigger) => contexts.set(id, contexts.get(trigger)),
	destroy: (id) => contexts.delete(id),
});

let refs = 0;

export const ref = (): void => {
	refs++ || hook.enable();
};

export const unref = (): void => {
	--refs || hook.disable();
};

export const create = (data: any): void => {
	contexts.set(executionAsyncId(), data);
};

export const current = (): any => contexts.get(executionAsyncId());
