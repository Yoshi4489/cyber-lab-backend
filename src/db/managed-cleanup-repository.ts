import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from './client.js';
import { auditEvents, instances } from './schema.js';
import type { CleanupIntent, ManagedCleanupRepository } from '../services/managed-resource-cleanup.js';
import type { RuntimeInstanceState } from '../services/lifecycle-state.js';

export class DrizzleManagedCleanupRepository implements ManagedCleanupRepository {
  constructor(private readonly database: Database) {}

  async readSnapshot(nodeId: string, observedIds: readonly string[]): Promise<RuntimeInstanceState[]> {
    return this.database.select().from(instances).where(or(
      eq(instances.nodeId, nodeId),
      observedIds.length ? inArray(instances.id, [...observedIds]) : undefined,
    ));
  }

  async beginCleanup(intents: readonly CleanupIntent[], now: Date): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const current = await transaction.select().from(instances)
        .where(inArray(instances.id, intents.map(({ instanceId }) => instanceId))).for('update');
      for (const intent of intents) {
        const record = current.find(({ id }) => id === intent.instanceId);
        assertUnchangedTerminalIntent(record, intent);
      }
      await transaction.insert(auditEvents).values(intents.map((intent) => ({
        eventType: 'instance.orphan_cleanup_started',
        details: { instanceId: intent.instanceId, nodeId: intent.nodeId, reason: intent.reason }, createdAt: now,
      })));
    });
  }

  async completeCleanup(intents: readonly CleanupIntent[], now: Date): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const current = await transaction.select().from(instances)
        .where(inArray(instances.id, intents.map(({ instanceId }) => instanceId))).for('update');
      for (const intent of intents) assertUnchangedTerminalIntent(current.find(({ id }) => id === intent.instanceId), intent);
      for (const intent of intents) {
        await transaction.update(instances).set({ nodeId: null, containerId: null, networkId: null, routeKey: null, updatedAt: now })
          .where(and(eq(instances.id, intent.instanceId), inArray(instances.status, ['stopped', 'failed', 'expired']),
            or(eq(instances.nodeId, intent.nodeId), isNull(instances.nodeId))));
      }
      await transaction.insert(auditEvents).values(intents.map((intent) => ({
        eventType: 'instance.orphan_cleanup_succeeded',
        details: { instanceId: intent.instanceId, nodeId: intent.nodeId, reason: intent.reason }, createdAt: now,
      })));
    });
  }

  async recordCleanupFailure(intents: readonly CleanupIntent[], now: Date): Promise<void> {
    await this.database.insert(auditEvents).values(intents.map((intent) => ({
      eventType: 'instance.orphan_cleanup_failed',
      details: { instanceId: intent.instanceId, nodeId: intent.nodeId, failureCode: 'cleanup_failed' }, createdAt: now,
    })));
  }
}

function assertUnchangedTerminalIntent(record: typeof instances.$inferSelect | undefined, intent: CleanupIntent): void {
  if (record && (!['stopped', 'failed', 'expired'].includes(record.status) ||
    !intent.record || record.userId !== intent.record.userId || record.nodeId !== intent.record.nodeId ||
    record.challengeId !== intent.record.challengeId || record.routeKey !== intent.record.routeKey ||
    record.containerId !== intent.record.containerId || record.networkId !== intent.record.networkId ||
    (record.nodeId !== null && record.nodeId !== intent.nodeId) ||
    (intent.allocation.challengeId !== null && record.challengeId !== intent.allocation.challengeId))) {
    throw new Error('Runtime intent changed before cleanup');
  }
}
