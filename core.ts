/**
 * The core module for `@nahara/remember`.
 *
 * **Memoizing**: The one and only recommended use case for `remember()` is to memoize values - it is literally there in
 * the name. The context only provides `remember()` and `rememberAsync()` - the rest of module relies on these 2
 * functions. Memoizing typically used to optimize performance, where a calculation is so heavy that it should onlt be
 * called once. However, caching the value is not the only use case for `remember()`, but it can also be used to
 * allocate resources exactly once for given combination of dependencies.
 *
 * ```typescript
 * function renderer({ remember }: Context, state: ObjectState) {
 *     const buffer = remember(withRelease(() => device.createBuffer({ ...options }), x => x.close()), [state.url]);
 * }
 * ```
 *
 * From the example above, `device.createBuffer()` will only be called once until `state.url` changed to different
 * value. When that happened, the `GPUBuffer` will be closed.
 *
 * @module
 */

import { AsyncThrowable } from "./internal.ts";

/**
 * - `done`: The invocation finished normally;
 * - `promise`: An unfulfilled `Promise` found while invoking the function and it need to be fulfilled before it can be
 * invoked again.
 */
export type InvokeResult<R> =
    | { type: "done"; value: R }
    | { type: "promise"; task: Promise<unknown> };

/**
 * **Context**: Unlike React or Jetpack Compose, hooks can only be obtained from {@link Context}, which makes it easy to
 * perform tests in parallel, at a cost of writing more boilerplate code.
 */
export interface Context {
    /**
     * Remember a value in the scope. The function will be called when the scope is first invoked, or any value in the
     * dependencies array changed.
     *
     * ```typescript
     * function main({ remember }: Context, device: GPUDevice, size: [number, number]) {
     *     const texture = remember(() => device.createTexture({ format: "rgba8unorm", usage: 0, size }));
     * }
     * ```
     *
     * **Abort signal**: When a value in dependency array changed OR the scope is about to be closed, the `AbortSignal`
     * provided to the factory will be triggered. This abort signal may be used to, for example, cancel ongoing task or
     * release resources that was previously constructed.
     *
     * ```typescript
     * function main({ remember }: Context) {
     *     const task = remember(signal => fetch("http://127.0.0.1:8080", { signal }));
     * }
     * ```
     *
     * @param factory The factory that produces the value.
     * @param deps A list of dependencies that will be used to track whether the factory should be evaluated again.
     */
    remember<T>(factory: Factory<T>, deps?: unknown[]): T;

    /**
     * Async version of {@link remember} that unwraps `Promise<T>` to `T`.
     *
     * ```typescript
     * function main({ rememberAsync }: Context, props: { url: URL }) {
     *     const image = remember(() => loadImageAsync(props.url), [props.url]);
     *     drawImage(image);
     * }
     * ```
     *
     * @param factory The factory that produces the value.
     * @param deps A list of dependencies that will be used to track whether the factory should be evaluated again.
     */
    rememberAsync<T>(factory: AsyncFactory<T>, deps?: unknown[]): T;

    /**
     * Invoke the function using this context. Typically used with destructor:
     *
     * ```typescript
     * function main({ use }: Context, device: GPUDevice, source: GPUTexture, target: GPUTexture) {
     *     const blit = use(utils.blit, device, source);
     *     blit(target);
     * }
     * ```
     *
     * @param func The function that will be invoked.
     * @param params A list of parameters to pass to function.
     */
    use<P extends unknown[], R>(func: (context: Context, ...params: P) => R, ...params: P): R;
}

/**
 * The value factory that produces a value and optionally clean up when the value is no longer used, like when closing
 * the scope of when a value in dependency array changed on next invocation.
 */
export type Factory<T> = (signal: AbortSignal) => T;

/**
 * Async version of {@link Factory}
 */
export type AsyncFactory<T> = (signal: AbortSignal) => Promise<T>;

type Hook =
    | { stage: "wait"; deps: unknown[]; controller: AbortController; task: Promise<unknown> }
    | { stage: "done"; deps: unknown[]; controller: AbortController; value: unknown }
    | { stage: "error"; deps: unknown[]; controller: AbortController; error: unknown };

function compareArray(a: unknown[], b: unknown[]): boolean {
    if (a.length != b.length) throw new Error(`Dependency array length changed from previous to next state`);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/**
 * A scope stores all remembered values until {@link Scope.close()} is called or {@link Scope} is disposed.
 */
export class Scope implements Disposable {
    #hooks = new Map<number, Hook>();

    #handleRemember<T>(id: number, deps: unknown[], hookFactory: (controller: AbortController) => Hook) {
        let hook = this.#hooks.get(id) ?? null;

        if (hook != null && !compareArray(hook.deps, deps)) {
            hook.controller.abort();
            this.#hooks.delete(id);
            hook = null;
        }

        if (hook == null) {
            const controller = new AbortController();
            this.#hooks.set(id, hook = hookFactory(controller));
        }

        switch (hook.stage) {
            case "done":
                return hook.value as T;
            case "wait":
                throw new AsyncThrowable(hook.task);
            case "error":
                throw hook.error;
            default:
                throw new Error("Invalid hook stage");
        }
    }

    /**
     * Invoke the function.
     *
     * @param func The function that will be invoked.
     * @param params A list of arguments to pass to the function.
     */
    invoke<P extends unknown[], R>(func: (context: Context, ...params: P) => R, ...params: P): InvokeResult<R> {
        try {
            let counter = 0;
            const context: Partial<Context> = {};

            context.remember = <T>(factory: Factory<T>, deps = []) =>
                this.#handleRemember(counter++, deps, (controller) => {
                    try {
                        return {
                            stage: "done",
                            controller,
                            value: factory(controller.signal),
                            deps,
                        };
                    } catch (e) {
                        return {
                            stage: "error",
                            controller,
                            error: e,
                            deps,
                        };
                    }
                });

            context.rememberAsync = (factory, deps = []) => {
                const id = counter++;

                return this.#handleRemember(id, deps, (controller) => ({
                    stage: "wait",
                    controller,
                    deps,
                    task: factory(controller.signal)
                        .then((value) => this.#hooks.set(id, { stage: "done", controller, deps, value }))
                        .catch((error) => this.#hooks.set(id, { stage: "error", controller, deps, error })),
                }));
            };

            context.use = (func, ...params) => func(context as Context, ...params);

            const result = func(context as Context, ...params);
            return { type: "done", value: result };
        } catch (e) {
            if (e instanceof AsyncThrowable) return { type: "promise", task: e.promise };
            throw e;
        }
    }

    /**
     * Async version of {@link invoke}, which always return `Promise<R>` instead of `InvokeResult<R>`. If the function
     * need to remember value from `Promise` but that promise hasn't been fulfilled yet, the function will await that
     * promise and then reinvoke the function.
     *
     * @param func The function that will be invoked.
     * @param args A list of arguments to pass to the function.
     */
    async invokeAsync<P extends unknown[], R>(func: (context: Context, ...args: P) => R, ...args: P): Promise<R> {
        let result: InvokeResult<R>;
        while ((result = this.invoke(func, ...args)).type == "promise") await result.task;
        return result.value;
    }

    /**
     * Trigger all abort controllers and clear all hooks from this scope.
     */
    close(): void {
        for (const hook of this.#hooks.values()) hook.controller.abort();
        this.#hooks.clear();
    }

    [Symbol.dispose]() {
        this.close();
    }
}
