# `@nahara/remember`
This package is primarily used for caching the value when invoking function multiple times, such as allocating `GPUTexture` once for renderer for example. The usage is basically a combination of React's `useMemo`/`useEffect`, but the cleanup happens on `abort` event of `AbortSignal` instead of returning the cleanup function.

The `remember()` and its async counterpart can be used to cache the calculation once for a given combination of dependencies.

This package is part of Nahara's Motion, primarily used in rendering stage.

## Modules
- `@nahara/remember`: Exports everything;
- `@nahara/remember/core`: The core module of this package, providing the remember functionality;
- `@nahara/remember/fork`: Fork state factory for forking the remember scope;
- `@nahara/remember/disposable`: Factory wrappers for `Disposable` and objects with explict resource management.

## Example
### Translating React's code to `@nahara/remember`
```typescript
// React
function App() {
    const answer = useMemo(() => 42, []);
    const resource = useMemo(() => allocate(), []);

    useEffect(() => {
        return () => release(resource);
    }, []);
}

// @nahara/remember
function main({ remember }: Context) {
    const answer = remember(() => 42);
    const resource = remember(withRelease(() => allocate(), x => release(x)));
}
```

### Example with WebGPU
```typescript
import { Scope, withRelease } from "@nahara/remember";

using scope = new Scope();

await scope.invokeAsync(({ remember, rememberAsync }) => {
    const device = rememberAsync(async () => {
        const adapter = await navigator.gpu.requestAdapter();
        return await adapter!.requestDevice();
    });

    const texture = remember(
        withRelease(
            () =>
                device.createTexture({
                    format: "rgba8unorm",
                    size: [1024, 1024],
                    usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
                }),
            (x) => {
                console.log("destroying", x);
                x.destroy();
            },
        ),
        [device],
    );

    const command = device.createCommandEncoder();
    command.beginRenderPass({
        colorAttachments: [
            {
                view: texture.createView(),
                loadOp: "clear",
                storeOp: "store",
                clearValue: [1, 0, 0, 1],
            },
        ],
    }).end();
    device.queue.submit([command.finish()]);
});
```

### Fork state (`/fork`)
Forking can be used to create child scopes inside current one. If the ID is no longer referenced by `fork()` function,
the related child scope will be closed at the end of the invocation of the callback.

```typescript
remember(forkState)(fork => {
    fork("object id", ({ remember }) => {
        const img = remember(() => loadImage("object image"));
    });
    // fork()...
});
```

## License
MIT License.