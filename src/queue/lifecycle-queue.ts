import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import {
  LIFECYCLE_QUEUE_NAME,
  type LifecycleJobData,
  type LifecycleJobRepository,
  type LifecycleOperationHandler,
  type LifecycleOperationType,
} from './contracts.js';

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1_000;

export const lifecycleJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
  removeOnFail: false,
};

export class LifecycleQueue {
  private readonly queue: Queue<LifecycleJobData, void, LifecycleOperationType>;
  private readonly workerConnections = new Set<Redis>();

  constructor(
    private readonly connection: Redis,
    private readonly repository: LifecycleJobRepository,
    queueName = LIFECYCLE_QUEUE_NAME,
    private readonly clock: () => Date = () => new Date(),
    private readonly jobOptions: JobsOptions = lifecycleJobOptions,
  ) {
    this.queue = new Queue(queueName, { connection });
  }

  async dispatchPending(limit = 100): Promise<number> {
    const now = this.clock();
    await this.repository.recoverStaleOperations(
      new Date(now.getTime() - DEFAULT_STALE_AFTER_MS),
    );
    const operations = await this.repository.listPendingOperations(limit);
    for (const operation of operations) {
      await this.queue.add(
        operation.type,
        { operationId: operation.id },
        { ...this.jobOptions, jobId: operation.id },
      );
      await this.repository.markQueued(operation.id, now);
    }
    return operations.length;
  }

  async scheduleMaintenance(): Promise<void> {
    const now = this.clock();
    const bucket = now.toISOString().slice(0, 16);
    await this.repository.createMaintenanceIntents(now, bucket);
    await this.dispatchPending();
  }

  createWorker(handler: LifecycleOperationHandler): Worker<LifecycleJobData, void, LifecycleOperationType> {
    const workerConnection = this.connection.duplicate();
    const worker = new Worker<LifecycleJobData, void, LifecycleOperationType>(
      this.queue.name,
      async (job) => {
        const operation = await this.repository.claimOperation(job.data.operationId, this.clock());
        if (!operation) return;
        await handler.handle(operation);
        await this.repository.markSucceeded(operation.id, this.clock());
      },
      {
        connection: workerConnection,
        // The Phase 3 single-node worker must not overlap spawn and destroy for one instance.
        concurrency: 1,
      },
    );
    worker.on('failed', (job) => {
      if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
      void this.repository
        .markFailed(job.data.operationId, 'execution_failed', this.clock())
        .catch(() => undefined);
    });
    // BullMQ treats a supplied Redis instance as shared and leaves it open on
    // Worker.close(). This queue owns the duplicate and releases it in close().
    this.workerConnections.add(workerConnection);
    return worker;
  }

  async getFailed(limit = 100) {
    return this.queue.getFailed(0, Math.max(0, limit - 1));
  }

  async close(): Promise<void> {
    await this.queue.close();
    for (const workerConnection of this.workerConnections) {
      if (workerConnection.status !== 'end') await workerConnection.quit();
    }
    this.workerConnections.clear();
    await this.connection.quit();
  }
}

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
