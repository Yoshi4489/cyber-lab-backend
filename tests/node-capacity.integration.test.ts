import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleLifecycleStateRepository } from '../src/db/lifecycle-state-repository.js';
import { auditEvents, instances, labNodes, users } from '../src/db/schema.js';
import type { DockerOrchestrator } from '../src/orchestrator/docker-adapter.js';
import { RuntimeManifestRegistry } from '../src/orchestrator/runtime-manifests.js';
import type { ClaimedLifecycleOperation } from '../src/queue/contracts.js';
import { DockerLifecycleHandler } from '../src/services/docker-lifecycle-handler.js';
import { HmacInstanceFlagService } from '../src/services/instance-flags.js';
import type { ManagedRuntimeAllocation, ManagedRuntimeInventory } from '../src/services/runtime-inventory.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const challenge = CHALLENGE_DEFINITIONS[0]!;

describeDatabase('single-node capacity admission', () => {
  let database: DatabaseClient;
  let state: DrizzleLifecycleStateRepository;
  const userIds: string[] = [];
  const nodeIds: string[] = [];

  beforeAll(async () => {
    database = createDatabase(databaseUrl!);
    await seedCatalog(database.db);
    state = new DrizzleLifecycleStateRepository(database.db);
  });
  afterEach(async () => {
    if (userIds.length) await database.db.delete(users).where(inArray(users.id, userIds.splice(0)));
    if (nodeIds.length) await database.db.delete(labNodes).where(inArray(labNodes.id, nodeIds.splice(0)));
  });
  afterAll(async () => { await database?.close(); });

  async function fixture(capacity: number, count: number) {
    const now = new Date();
    const nodeId = await state.registerNode(`capacity-${randomUUID()}`, capacity, now);
    nodeIds.push(nodeId);
    const records = [];
    for (let index = 0; index < count; index += 1) {
      const userId = randomUUID();
      userIds.push(userId);
      await database.db.insert(users).values({ id: userId, email: `capacity-${userId}@example.test`, passwordHash: 'test-only' });
      const [record] = await database.db.insert(instances).values({
        userId, challengeId: challenge.id, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 3_600_000),
        absoluteExpiresAt: new Date(now.getTime() + 7_200_000),
      }).returning();
      records.push(record!);
    }
    const reserve = (instanceId: string, inventory: ManagedRuntimeAllocation[] = []) => state.prepareSpawn({
      instanceId, nodeId, routeKey: instanceId.replaceAll('-', ''), inventory: {
        allocations: inventory,
        containerIds: inventory.flatMap(({ containerId }) => containerId ? [containerId] : []),
        networkIds: inventory.flatMap(({ networkId }) => networkId ? [networkId] : []),
      }, now: new Date(),
    });
    return { records, nodeId, reserve };
  }

  it('serializes concurrent admissions and audits asynchronous refusal without allocating excess slots', async () => {
    const { records, reserve, nodeId } = await fixture(3, 8);
    const prepared = await Promise.all(records.map((record) => reserve(record.id)));
    expect(prepared.filter(Boolean)).toHaveLength(3);
    const persisted = await database.db.select().from(instances).where(inArray(instances.id, records.map(({ id }) => id)));
    expect(persisted.filter((record) => record.nodeId === nodeId)).toHaveLength(3);
    expect(persisted.filter((record) => record.status === 'failed' && record.failureCode === 'node_capacity_exhausted')).toHaveLength(5);
    const audits = await database.db.select().from(auditEvents).where(inArray(auditEvents.targetUserId, userIds));
    expect(audits.filter(({ eventType }) => eventType === 'instance.capacity_refused')).toHaveLength(5);
  });

  it('reuses retry reservations and keeps cleanup leftovers charged until a complete inventory proves absence', async () => {
    const { records: [first, second, third], reserve, nodeId } = await fixture(1, 3);
    expect(await reserve(first!.id)).toMatchObject({ nodeId, status: 'provisioning' });
    expect(await reserve(first!.id)).toMatchObject({ nodeId, status: 'provisioning' });
    await database.db.update(instances).set({ status: 'failed', failureCode: 'execution_failed' }).where(eq(instances.id, first!.id));
    const routeOnly = { instanceId: first!.id, challengeId: null, containerId: null, networkId: null, routePresent: true };
    expect(await reserve(second!.id, [routeOnly])).toBeNull();
    expect(await state.findInstance(first!.id)).toMatchObject({ nodeId });
    expect(await reserve(third!.id, [])).toMatchObject({ nodeId });
    expect(await state.findInstance(first!.id)).toMatchObject({ nodeId: null });
  });

  it.each(['containerId', 'networkId', 'routePresent'] as const)('counts orphan %s allocations without a database reservation', async (kind) => {
    const { records: [pending], reserve } = await fixture(1, 1);
    const orphan: ManagedRuntimeAllocation = {
      instanceId: randomUUID(), challengeId: challenge.id, containerId: null, networkId: null, routePresent: false,
    };
    if (kind === 'routePresent') orphan.routePresent = true;
    else orphan[kind] = 'orphan-resource';
    expect(await reserve(pending!.id, [orphan])).toBeNull();
    expect(await state.findInstance(pending!.id)).toMatchObject({ status: 'failed', nodeId: null });
  });

  it('aborts a mismatched ownership snapshot without releasing reservations or admitting a new target', async () => {
    const { records: [first, pending], reserve, nodeId } = await fixture(1, 2);
    await reserve(first!.id);
    await database.db.update(instances).set({ status: 'failed', containerId: 'persisted-container' }).where(eq(instances.id, first!.id));
    await expect(reserve(pending!.id, [{
      instanceId: randomUUID(), challengeId: challenge.id,
      containerId: 'persisted-container', networkId: null, routePresent: false,
    }])).rejects.toThrow('ownership differs');
    expect(await state.findInstance(first!.id)).toMatchObject({ nodeId });
    expect(await state.findInstance(pending!.id)).toMatchObject({ status: 'pending', nodeId: null });
  });

  it('does not allocate against an unavailable node and persists explicit configured capacity on restart', async () => {
    const { records: [pending], reserve, nodeId } = await fixture(1, 1);
    const node = (await database.db.select().from(labNodes).where(eq(labNodes.id, nodeId)))[0]!;
    expect(await state.registerNode(node.name, 4, new Date())).toBe(nodeId);
    expect((await database.db.select().from(labNodes).where(eq(labNodes.id, nodeId)))[0]?.capacitySlots).toBe(4);
    await database.db.update(labNodes).set({ status: 'offline' }).where(eq(labNodes.id, nodeId));
    await expect(reserve(pending!.id)).rejects.toThrow('unavailable');
    expect(await state.findInstance(pending!.id)).toMatchObject({ status: 'pending', nodeId: null });
  });

  it('retains a terminal reservation if a persisted resource still exists with stripped managed labels', async () => {
    const { records: [first, pending], reserve, nodeId } = await fixture(1, 2);
    await reserve(first!.id);
    await database.db.update(instances).set({ status: 'failed', containerId: 'stripped-container' }).where(eq(instances.id, first!.id));
    await expect(state.prepareSpawn({
      instanceId: pending!.id, nodeId, routeKey: pending!.id.replaceAll('-', ''), now: new Date(),
      inventory: { allocations: [], containerIds: ['stripped-container'], networkIds: [] },
    })).rejects.toThrow('ownership differs');
    expect(await state.findInstance(first!.id)).toMatchObject({ nodeId });
    expect(await state.findInstance(pending!.id)).toMatchObject({ nodeId: null, status: 'pending' });
  });

  it('fails closed on inventory/storage failure and never completes a stop while cleanup resources remain', async () => {
    const { records: [record, blocked], nodeId } = await fixture(1, 2);
    const spawn = vi.fn(async () => ({ containerId: 'container', networkId: 'network' }));
    const destroy = vi.fn(async () => undefined);
    const inventory = vi.fn(async (): Promise<ManagedRuntimeInventory> => ({ allocations: [], containerIds: [], networkIds: [] }));
    const manifests = new RuntimeManifestRegistry([{
      challengeId: challenge.id, image: `sha256:${'a'.repeat(64)}`, containerPort: 8080, user: '65532:65532',
      healthcheck: { test: ['CMD', '/healthcheck'], intervalSeconds: 5, timeoutSeconds: 3, retries: 5, startupSeconds: 30 },
      resources: { memoryMb: 128, cpuCores: 0.5, pids: 64, tmpfsMb: 16 },
    }]);
    const handler = new DockerLifecycleHandler(state, manifests,
      new HmacInstanceFlagService('capacity-test-secret-at-least-thirty-two-characters'),
      { spawn, destroy, inventoryManagedResources: inventory } as unknown as DockerOrchestrator, nodeId);
    const operation: ClaimedLifecycleOperation = {
      id: randomUUID(), type: 'spawn', attempts: 1,
      instance: { ...record!, status: 'pending' },
    };
    inventory.mockRejectedValueOnce(new Error('inventory unavailable'));
    await expect(handler.handle(operation)).rejects.toThrow('inventory unavailable');
    expect(spawn).not.toHaveBeenCalled();
    expect(await state.findInstance(record!.id)).toMatchObject({ nodeId: null, status: 'pending' });
    const prepare = vi.spyOn(state, 'prepareSpawn').mockRejectedValueOnce(new Error('database unavailable'));
    await expect(handler.handle(operation)).rejects.toThrow('database unavailable');
    prepare.mockRestore();
    expect(spawn).not.toHaveBeenCalled();
    spawn.mockRejectedValueOnce(new Error('partial spawn failed'));
    await expect(handler.handle(operation)).rejects.toThrow('partial spawn failed');
    expect(await state.findInstance(record!.id)).toMatchObject({ nodeId, status: 'provisioning' });
    await handler.handle({ ...operation, instance: { ...blocked!, status: 'pending' } });
    expect(await state.findInstance(blocked!.id)).toMatchObject({ status: 'failed' });
    expect((await database.db.select().from(instances).where(eq(instances.id, blocked!.id)))[0]?.failureCode).toBe('node_capacity_exhausted');
    expect(spawn).toHaveBeenCalledOnce();
    await handler.handle(operation);
    expect(spawn).toHaveBeenCalledTimes(2);
    await database.db.update(instances).set({ status: 'stopping' }).where(eq(instances.id, record!.id));
    inventory.mockResolvedValueOnce({ allocations: [{
      instanceId: record!.id, challengeId: challenge.id, containerId: null, networkId: 'network', routePresent: false,
    }], containerIds: [], networkIds: ['network'] });
    await expect(handler.handle({ ...operation, type: 'destroy' })).rejects.toThrow('remain after cleanup');
    expect(await state.findInstance(record!.id)).toMatchObject({ nodeId, status: 'stopping' });
    inventory.mockRejectedValueOnce(new Error('inventory unavailable'));
    await expect(handler.handle({ ...operation, type: 'destroy' })).rejects.toThrow('inventory unavailable');
    expect(await state.findInstance(record!.id)).toMatchObject({ nodeId, status: 'stopping' });
    inventory.mockResolvedValueOnce({ allocations: [], containerIds: ['container'], networkIds: [] });
    await expect(handler.handle({ ...operation, type: 'destroy' })).rejects.toThrow('remain after cleanup');
    expect(await state.findInstance(record!.id)).toMatchObject({ nodeId, status: 'stopping' });
    await handler.handle({ ...operation, type: 'destroy' });
    expect(await state.findInstance(record!.id)).toMatchObject({ nodeId: null, status: 'stopped' });
  });
});
