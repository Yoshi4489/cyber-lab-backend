import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleLifecycleJobRepository } from '../src/db/lifecycle-job-repository.js';
import { instanceOperations, instances, users } from '../src/db/schema.js';
import type { LifecycleJobData, LifecycleOperationType } from '../src/queue/contracts.js';
import {
  createRedisConnection,
  LifecycleQueue,
  lifecycleJobOptions,
} from '../src/queue/lifecycle-queue.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRedisUrl = process.env.TEST_REDIS_URL;
const describeInfrastructure = testDatabaseUrl && testRedisUrl ? describe : describe.skip;

describeInfrastructure('durable lifecycle queue', () => {
  let database: DatabaseClient;
  let repository: DrizzleLifecycleJobRepository;
  let queue: LifecycleQueue;
  let worker: Worker<LifecycleJobData, void, LifecycleOperationType>;
  const userId = randomUUID();
  let instanceId: string;

  beforeAll(async () => {
    if (!testDatabaseUrl || !testRedisUrl) throw new Error('Test infrastructure is required');
    const challenge = CHALLENGE_DEFINITIONS[0];
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db);
    await database.db.insert(users).values({
      id: userId,
      email: `queue-${userId}@example.test`,
      passwordHash: 'test-only-placeholder-hash',
    });
    const now = new Date();
    const [instance] = await database.db
      .insert(instances)
      .values({
        userId,
        challengeId: challenge.id,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
        absoluteExpiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1_000),
      })
      .returning({ id: instances.id });
    if (!instance) throw new Error('Instance insert returned no id');
    instanceId = instance.id;
    repository = new DrizzleLifecycleJobRepository(database.db);
    queue = new LifecycleQueue(
      createRedisConnection(testRedisUrl),
      repository,
      `lifecycle-test-${randomUUID()}`,
      () => new Date(),
      {
        ...lifecycleJobOptions,
        attempts: 2,
        backoff: { type: 'fixed', delay: 10 },
      },
    );
    worker = queue.createWorker({
      handle: async (operation) => {
        if (operation.type === 'reconcile') throw new Error('deliberate test failure');
      },
    });
    await worker.waitUntilReady();
  }, 30_000);

  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    await database?.db.delete(users).where(eq(users.id, userId));
    await database?.close();
  });

  it('delivers a pending operation once with its database id as the job id', async () => {
    const operationId = await insertOperation('spawn', 'queue-spawn-001');

    await expect(queue.dispatchPending()).resolves.toBe(1);
    await expect(queue.dispatchPending()).resolves.toBe(0);
    await waitForOperation(operationId, 'succeeded');

    const operation = await readOperation(operationId);
    expect(operation).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('bounds retries and retains failed jobs for inspection', async () => {
    const operationId = await insertOperation('reconcile', 'queue-reconcile-001');

    await expect(queue.dispatchPending()).resolves.toBe(1);
    await waitForOperation(operationId, 'failed');

    const operation = await readOperation(operationId);
    expect(operation).toMatchObject({
      status: 'failed',
      attempts: 2,
      failureCode: 'execution_failed',
    });
    const failed = await queue.getFailed();
    expect(failed.some((job) => job.id === operationId)).toBe(true);
  });

  it('creates idempotent reaper and reconciliation intent from persisted state', async () => {
    const expiredAt = new Date(Date.now() - 1_000);
    await database.db
      .update(instances)
      .set({ status: 'running', expiresAt: expiredAt, updatedAt: expiredAt })
      .where(eq(instances.id, instanceId));

    const maintenanceAt = new Date();
    await repository.createMaintenanceIntents(maintenanceAt, '2026-01-01T00:00');
    await repository.createMaintenanceIntents(maintenanceAt, '2026-01-01T00:00');

    const instance = await database.db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
    });
    expect(instance?.status).toBe('stopping');
    const operations = await database.db
      .select({
        type: instanceOperations.type,
        idempotencyKey: instanceOperations.idempotencyKey,
      })
      .from(instanceOperations)
      .where(eq(instanceOperations.instanceId, instanceId));
    expect(operations.filter(({ type }) => type === 'reap')).toHaveLength(1);
    expect(
      operations.filter(({ idempotencyKey }) => idempotencyKey === 'reconcile-2026-01-01T00:00'),
    ).toHaveLength(1);
  });

  it('does not reconcile an instance while its spawn operation is active', async () => {
    const challenge = CHALLENGE_DEFINITIONS[0];
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    const anotherUserId = randomUUID();
    await database.db.insert(users).values({
      id: anotherUserId,
      email: `queue-spawn-${anotherUserId}@example.test`,
      passwordHash: 'test-only-placeholder-hash',
    });
    try {
      const now = new Date();
      const [anotherInstance] = await database.db.insert(instances).values({
        userId: anotherUserId,
        challengeId: challenge.id,
        expiresAt: new Date(now.getTime() + 60 * 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 2 * 60 * 60_000),
      }).returning({ id: instances.id });
      if (!anotherInstance) throw new Error('Instance insert returned no id');
      await database.db.insert(instanceOperations).values({
        instanceId: anotherInstance.id,
        userId: anotherUserId,
        type: 'spawn',
        idempotencyKey: 'queue-active-spawn',
        requestHash: 'a'.repeat(64),
      });

      await repository.createMaintenanceIntents(now, '2026-01-01T00:01');
      const operations = await database.db.select({ type: instanceOperations.type })
        .from(instanceOperations)
        .where(eq(instanceOperations.instanceId, anotherInstance.id));
      expect(operations.map(({ type }) => type)).toEqual(['spawn']);
    } finally {
      await database.db.delete(users).where(eq(users.id, anotherUserId));
    }
  });

  async function insertOperation(type: LifecycleOperationType, idempotencyKey: string) {
    const [operation] = await database.db
      .insert(instanceOperations)
      .values({
        instanceId,
        userId,
        type,
        idempotencyKey,
        requestHash: 'a'.repeat(64),
      })
      .returning({ id: instanceOperations.id });
    if (!operation) throw new Error('Operation insert returned no id');
    return operation.id;
  }

  async function readOperation(operationId: string) {
    return database.db.query.instanceOperations.findFirst({
      where: eq(instanceOperations.id, operationId),
    });
  }

  async function waitForOperation(
    operationId: string,
    expectedStatus: 'succeeded' | 'failed',
  ): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const operation = await readOperation(operationId);
      if (operation?.status === expectedStatus) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Operation ${operationId} did not become ${expectedStatus}`);
  }
});
