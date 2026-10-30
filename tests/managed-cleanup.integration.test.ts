import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleManagedCleanupRepository } from '../src/db/managed-cleanup-repository.js';
import { DrizzleLifecycleStateRepository } from '../src/db/lifecycle-state-repository.js';
import { auditEvents, instances, labNodes, users } from '../src/db/schema.js';
import { ManagedResourceSweeper } from '../src/services/managed-resource-cleanup.js';
import type { ManagedRuntimeAllocation, ManagedRuntimeInventory } from '../src/services/runtime-inventory.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('managed cleanup persistence and audit', () => {
  let database: DatabaseClient;
  let userId: string;
  let nodeId: string;
  let repository: DrizzleManagedCleanupRepository;

  beforeAll(async () => {
    database = createDatabase(databaseUrl!);
    await seedCatalog(database.db);
  });
  afterEach(async () => {
    if (userId) await database.db.delete(users).where(eq(users.id, userId));
    if (nodeId) await database.db.delete(labNodes).where(eq(labNodes.id, nodeId));
  });
  afterAll(async () => { await database?.close(); });

  async function fixture() {
    userId = randomUUID();
    await database.db.insert(users).values({ id: userId, email: `cleanup-${userId}@example.test`, passwordHash: 'test-only' });
    nodeId = await new DrizzleLifecycleStateRepository(database.db).registerNode(`cleanup-${randomUUID()}`, 3, new Date());
    const instanceId = randomUUID();
    const challengeId = CHALLENGE_DEFINITIONS[0]!.id;
    const now = new Date();
    const resource: ManagedRuntimeAllocation = { instanceId, challengeId, containerId: 'cleanup-container', networkId: 'cleanup-network', routePresent: true };
    await database.db.insert(instances).values({
      id: instanceId, userId, challengeId, nodeId, status: 'failed', containerId: resource.containerId,
      networkId: resource.networkId, routeKey: instanceId.replaceAll('-', ''), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000), absoluteExpiresAt: new Date(now.getTime() + 7_200_000),
    });
    const remaining = new Map<string, ManagedRuntimeAllocation>([[instanceId, resource]]);
    const snapshot = (): ManagedRuntimeInventory => ({ allocations: [...remaining.values()],
      containerIds: [...remaining.values()].flatMap(({ containerId }) => containerId ? [containerId] : []),
      networkIds: [...remaining.values()].flatMap(({ networkId }) => networkId ? [networkId] : []) });
    const remove = vi.fn(async (id: string) => { remaining.delete(id); });
    const runtime = { inventoryManagedResources: vi.fn(async () => snapshot()),
      prepareManagedCleanup: vi.fn(async (allocations: readonly ManagedRuntimeAllocation[]) => allocations.map(
        ({ instanceId }) => () => remove(instanceId),
      )) };
    repository = new DrizzleManagedCleanupRepository(database.db);
    return { instanceId, remaining, resource, remove, sweeper: new ManagedResourceSweeper(repository, runtime, nodeId) };
  }

  const audits = () => database.db.select().from(auditEvents).where(sql`${auditEvents.details}->>'nodeId' = ${nodeId}`);

  it('records start and success for terminal/missing instances and releases capacity once', async () => {
    const f = await fixture();
    const missingId = randomUUID();
    f.remaining.set(missingId, { instanceId: missingId, challengeId: null, containerId: null, networkId: null, routePresent: true });
    await f.sweeper.sweep();
    const row = (await database.db.select().from(instances).where(eq(instances.id, f.instanceId)))[0]!;
    expect(row).toMatchObject({ status: 'failed', nodeId: null, containerId: null, networkId: null, routeKey: null });
    expect(f.remaining.size).toBe(0);
    expect((await audits()).map(({ eventType }) => eventType).sort()).toEqual([
      'instance.orphan_cleanup_started', 'instance.orphan_cleanup_started',
      'instance.orphan_cleanup_succeeded', 'instance.orphan_cleanup_succeeded',
    ]);
    await f.sweeper.sweep();
    expect(await audits()).toHaveLength(4);
  });

  it('rechecks persisted intent in the audit transaction before deleting', async () => {
    const f = await fixture();
    const begin = repository.beginCleanup.bind(repository);
    vi.spyOn(repository, 'beginCleanup').mockImplementationOnce(async (intents, now) => {
      await database.db.update(instances).set({ status: 'running' }).where(eq(instances.id, f.instanceId));
      await begin(intents, now);
    });
    await expect(f.sweeper.sweep()).rejects.toThrow('intent changed');
    expect(f.remove).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
  });

  it('keeps reservations and safe failure audits after partial cleanup, then recovers', async () => {
    const f = await fixture();
    f.remove.mockRejectedValueOnce(new Error('sensitive provider endpoint or secret'));
    await expect(f.sweeper.sweep()).rejects.toThrow('capacity is retained');
    expect((await database.db.select().from(instances).where(eq(instances.id, f.instanceId)))[0]?.nodeId).toBe(nodeId);
    const events = await audits();
    expect(events.map(({ eventType }) => eventType)).toContain('instance.orphan_cleanup_failed');
    expect(JSON.stringify(events)).not.toContain('sensitive');
    await f.sweeper.sweep();
    expect((await database.db.select().from(instances).where(eq(instances.id, f.instanceId)))[0]?.nodeId).toBeNull();
    expect((await audits()).filter(({ eventType }) => eventType === 'instance.orphan_cleanup_succeeded')).toHaveLength(1);
  });

  it('refuses a cleanup success claim if persisted intent changes during resource removal', async () => {
    const f = await fixture();
    f.remove.mockImplementationOnce(async (id) => {
      f.remaining.delete(id);
      await database.db.update(instances).set({ status: 'running' }).where(eq(instances.id, f.instanceId));
    });
    await expect(f.sweeper.sweep()).rejects.toThrow('capacity is retained');
    expect((await database.db.select().from(instances).where(eq(instances.id, f.instanceId)))[0]?.nodeId).toBe(nodeId);
    expect((await audits()).filter(({ eventType }) => eventType === 'instance.orphan_cleanup_succeeded')).toHaveLength(0);
  });
});
