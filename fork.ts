import { type Context, type InvokeResult, Scope } from "./core.ts";
import { AsyncThrowable } from "./internal.ts";

/**
 * Create a new fork state and return a function that can be used to fork to multiple child scopes. The fork state is
 * typically used together with `remember()`:
 * 
 * ```typescript
 * remember(forkState)(fork => {
 *     for (const object of objects) {
 *         fork(object.objectId, renderers.get(object.typeId));
 *     }
 * })
 * ```
 * 
 * At the end of callback, all keys that was previously used but doesn't get use in current invocation will be cleaned
 * up.
 * 
 * @param signal The abort signal that will be used to dispose all child scopes.
 * @returns A function that can be called to begin forking child scopes.
 */
export function forkState(signal: AbortSignal): <R>(callback: (fork: ForkFunction) => R) => R {
    const childScopes = new Map<unknown, Scope>();

    signal.addEventListener("abort", () => {
        for (const scope of childScopes.values()) scope.close();
        childScopes.clear();
    });

    return (callback) => {
        const unvisited = new Set(childScopes.keys());
        const result = callback((key, func, ...params) => {
            let scope = childScopes.get(key);
            if (scope == null) childScopes.set(key, scope = new Scope());
            unvisited.delete(key);

            const result = scope.invoke(func, ...params);
            if (result.type == "done") return result.value;
            if (result.type == "promise") throw new AsyncThrowable(result.task);
            throw new Error(`Invalid result type: ${(result as InvokeResult<unknown>).type}`);
        });

        for (const key of unvisited) {
            childScopes.get(key)?.close();
            childScopes.delete(key);
        }

        return result;
    };
}

export type ForkFunction = <P extends unknown[], R>(
    key: string,
    func: (context: Context, ...params: P) => R,
    ...params: P
) => R;
