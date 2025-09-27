import type { Factory } from "./core.ts";

/**
 * Wrap a factory and release function.
 * 
 * ```typescript
 * remember(withRelease(() => device.createTexture(), texture => texture.close()));
 * ```
 *
 * @param factory The factory that produces the resource.
 * @param release The function that releases the resource.
 * @returns A new remember factory that automatically call `release()` when no longer used.
 */
export function withRelease<T>(factory: () => T, release: (resource: T) => void): Factory<T> {
    return (signal) => {
        const resource = factory();
        signal.addEventListener("abort", () => release(resource));
        return resource;
    };
}

/**
 * Wrap a factory that automatically release `Disposable` when no longer used.
 *
 * ```typescript
 * remember(disposable(() => openFileStream("file.bin")));
 * ```
 *
 * @param factory The factory that produces `Disposable`.
 * @returns A new remember factory that automatically release the resource.
 */
export function disposable<T extends Disposable>(factory: () => T): Factory<T> {
    return withRelease(factory, (resource) => resource[Symbol.dispose]());
}
