export class AsyncThrowable {
    constructor(public readonly promise: Promise<unknown>) {}
}
