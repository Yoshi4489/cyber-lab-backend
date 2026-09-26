import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleLifecycleStateRepository } from '../src/db/lifecycle-state-repository.js';
import { auditEvents, instances, labNodes, users } from '../src/db/schema.js';
import type { DockerOrchestrator, RuntimeStatus } from '../src/orchestrator/docker-adapter.js';
import { RuntimeManifestRegistry } from '../src/orchestrator/runtime-manifests.js';
import type { ClaimedLifecycleOperation } from '../src/queue/contracts.js';
import { DockerLifecycleHandler } from '../src/services/docker-lifecycle-handler.js';
import { HmacInstanceFlagService } from '../src/services/instance-flags.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('Docker lifecycle state machine', () => {
  let database: DatabaseClient;
  let state: DrizzleLifecycleStateRepository;
  let handler: DockerLifecycleHandler;
  const userId = randomUUID();
  const nodeName = `handler-node-${randomUUID()}`;
  const now = new Date('2026-02-01T00:00:00.000Z');
  const challenge = CHALLENGE_DEFINITIONS[0];
  const spawn = vi.fn(async () => ({ containerId: 'container-1', networkId: 'network-1' }));
  const destroy = vi.fn(async () => undefined);
  const runtimeStatus = vi.fn(async (): Promise<RuntimeStatus> => 'healthy');

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db);
    await database.db.insert(users).values({
      id: userId,
      email: `handler-${userId}@example.test`,
      passwordHash: 'test-only-placeholder-hash',
    });
    state = new DrizzleLifecycleStateRepository(database.db);
    const nodeId = await state.registerNode(nodeName, now);
    const manifests = new RuntimeManifestRegistry([{
      challengeId: challenge.id,
      image: `sha256:${'b'.repeat(64)}`,
      containerPort: 8080,
      user: '65532:65532',
      healthcheck: {
        test: ['CMD', '/healthcheck'],
        intervalSeconds: 5,
        timeoutSeconds: 3,
        retries: 5,
        startupSeconds: 30,
      },
      resources: { memoryMb: 128, cpuCores: 0.5, pids: 64, tmpfsMb: 16 },
    }]);
    const orchestrator = {
      spawn,
      destroy,
      runtimeStatus,
    } as unknown as DockerOrchestrator;
    handler = new DockerLifecycleHandler(
      state,
      manifests,
      new HmacInstanceFlagService('handler-test-secret-at-least-thirty-two-characters'),
      orchestrator,
      nodeId,
      () => now,
    );
  }, 30_000);

  afterAll(async () => {
    await database?.db.delete(users).where(eq(users.id, userId));
    await database?.db.delete(labNodes).where(eq(labNodes.name, nodeName));
    await database?.close();
  });

  it('starts, recovers, and destroys targets through guarded transitions', async () => {
    const instanceId = await insertInstance('pending');
    await handler.handle(operation('spawn', instanceId, 'pending'));

    const running = await state.findInstance(instanceId);
    expect(running).toMatchObject({
      status: 'running',
      containerId: 'container-1',
      networkId: 'network-1',
    });
    expect(running?.routeKey).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      instanceId,
      challengeId: challenge?.id,
    }));

    await database.db
      .update(instances)
      .set({ status: 'stopping' })
      .where(eq(instances.id, instanceId));
    await handler.handle(operation('destroy', instanceId, 'stopping'));
    expect(await state.findInstance(instanceId)).toMatchObject({
      status: 'stopped',
      containerId: null,
      networkId: null,
      routeKey: null,
    });
    expect(destroy).toHaveBeenCalledWith({
      instanceId,
      containerId: 'container-1',
      networkId: 'network-1',
    });

    const recoveredId = await insertInstance('pending');
    const registeredNode = await database.db.query.labNodes.findFirst({
      where: eq(labNodes.name, nodeName),
    });
    if (!registeredNode) throw new Error('Expected registered node');
    await state.prepareSpawn({
      instanceId: recoveredId,
      nodeId: registeredNode.id,
      routeKey: 'recoverysafekeyabcdefghijklmnop',
      now,
    });
    await handler.handle(operation('reconcile', recoveredId, 'provisioning'));
    expect(await state.findInstance(recoveredId)).toMatchObject({ status: 'running' });

    await database.db
      .update(instances)
      .set({ status: 'stopping', expiresAt: new Date(now.getTime() - 1_000) })
      .where(eq(instances.id, recoveredId));
    await handler.handle(operation('reap', recoveredId, 'stopping'));
    expect(await state.findInstance(recoveredId)).toMatchObject({
      status: 'expired',
      containerId: null,
      networkId: null,
    });
  });

  it('destroys and audits an OOM-killed running target', async () => {
    const instanceId = await insertInstance('pending');
    await handler.handle(operation('spawn', instanceId, 'pending'));
    runtimeStatus.mockResolvedValueOnce('oom');

    await handler.handle(operation('reconcile', instanceId, 'running'));

    expect(await database.db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
    })).toMatchObject({ status: 'failed', failureCode: 'runtime_oom' });
    expect(destroy).toHaveBeenCalledWith({
      instanceId, containerId: 'container-1', networkId: 'network-1',
    });
    const audit = await database.db.query.auditEvents.findFirst({
      where: and(
        eq(auditEvents.eventType, 'instance.runtime_terminated'),
        eq(auditEvents.targetUserId, userId),
      ),
    });
    expect(audit?.details).toMatchObject({ instanceId, failureCode: 'runtime_oom' });
  });

  async function insertInstance(status: 'pending' | 'stopping'): Promise<string> {
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    const [instance] = await database.db
      .insert(instances)
      .values({
        userId,
        challengeId: challenge.id,
        status,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
        absoluteExpiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1_000),
      })
      .returning({ id: instances.id });
    if (!instance) throw new Error('Instance insert returned no id');
    return instance.id;
  }

  function operation(
    type: ClaimedLifecycleOperation['type'],
    instanceId: string,
    status: ClaimedLifecycleOperation['instance']['status'],
  ): ClaimedLifecycleOperation {
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    return {
      id: randomUUID(),
      type,
      attempts: 1,
      instance: {
        id: instanceId,
        userId,
        challengeId: challenge.id,
        status,
        nodeId: null,
        routeKey: null,
        containerId: null,
        networkId: null,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
        absoluteExpiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1_000),
      },
    };
  }
});
