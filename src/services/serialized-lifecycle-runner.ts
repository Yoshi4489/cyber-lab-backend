import type { ClaimedLifecycleOperation, LifecycleOperationHandler } from '../queue/contracts.js';

/** A single worker process shares this gate between queue execution and timer sweeps. */
export class SerializedLifecycleRunner implements LifecycleOperationHandler {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly handler: LifecycleOperationHandler,
    private readonly sweeper: { sweep(): Promise<void> },
  ) {}

  handle(operation: ClaimedLifecycleOperation): Promise<void> {
    return this.exclusive(() => this.handler.handle(operation));
  }

  sweep(): Promise<void> {
    return this.exclusive(() => this.sweeper.sweep());
  }

  drain(): Promise<void> {
    return this.tail;
  }

  private exclusive(work: () => Promise<void>): Promise<void> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
