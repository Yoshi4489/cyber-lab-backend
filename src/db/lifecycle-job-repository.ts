import { createHash } from 'node:crypto';
import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { instanceOperations, instances } from './schema.js';
import type {
  ClaimedLifecycleOperation,
  LifecycleJobRepository,
  LifecycleOperationType,
} from '../queue/contracts.js';

const operationSelection = {
  id: instanceOperations.id,
  type: instanceOperations.type,
  attempts: instanceOperations.attempts,
  instanceId: instances.id,
  userId: instances.userId,
  challengeId: instances.challengeId,
  instanceStatus: instances.status,
  nodeId: instances.nodeId,
  routeKey: instances.routeKey,
  containerId: instances.containerId,
  networkId: instances.networkId,
  expiresAt: instances.expiresAt,
  absoluteExpiresAt: instances.absoluteExpiresAt,
};

export class DrizzleLifecycleJobRepository implements LifecycleJobRepository {
  constructor(private readonly database: Database) {}

  async recoverStaleOperations(staleBefore: Date): Promise<void> {
    await this.database
      .update(instanceOperations)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(
        and(
          eq(instanceOperations.status, 'running'),
          lt(instanceOperations.updatedAt, staleBefore),
        ),
      );
  }

  async listPendingOperations(
    limit: number,
  ): Promise<Array<{ id: string; type: LifecycleOperationType }>> {
    return this.database
      .select({ id: instanceOperations.id, type: instanceOperations.type })
      .from(instanceOperations)
      .where(eq(instanceOperations.status, 'pending'))
      .orderBy(instanceOperations.createdAt)
      .limit(limit);
  }

  async markQueued(operationId: string, now: Date): Promise<void> {
    await this.database
      .update(instanceOperations)
      .set({ status: 'queued', updatedAt: now })
      .where(
        and(eq(instanceOperations.id, operationId), eq(instanceOperations.status, 'pending')),
      );
  }

  async claimOperation(
    operationId: string,
    now: Date,
  ): Promise<ClaimedLifecycleOperation | null> {
    return this.database.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(instanceOperations)
        .set({
          status: 'running',
          attempts: sql`${instanceOperations.attempts} + 1`,
          startedAt: sql`coalesce(${instanceOperations.startedAt}, ${now})`,
          updatedAt: now,
        })
        .where(
          and(
            eq(instanceOperations.id, operationId),
            inArray(instanceOperations.status, ['queued', 'running']),
          ),
        )
        .returning({ id: instanceOperations.id });
      if (!claimed) return null;

      const [operation] = await transaction
        .select(operationSelection)
        .from(instanceOperations)
        .innerJoin(instances, eq(instances.id, instanceOperations.instanceId))
        .where(eq(instanceOperations.id, operationId))
        .limit(1);
      if (!operation) throw new Error('Claimed operation has no instance');
      return {
        id: operation.id,
        type: operation.type,
        attempts: operation.attempts,
        instance: {
          id: operation.instanceId,
          userId: operation.userId,
          challengeId: operation.challengeId,
          status: operation.instanceStatus,
          nodeId: operation.nodeId,
          routeKey: operation.routeKey,
          containerId: operation.containerId,
          networkId: operation.networkId,
          expiresAt: operation.expiresAt,
          absoluteExpiresAt: operation.absoluteExpiresAt,
        },
      };
    });
  }

  async markSucceeded(operationId: string, now: Date): Promise<void> {
    await this.database
      .update(instanceOperations)
      .set({ status: 'succeeded', updatedAt: now, completedAt: now, failureCode: null })
      .where(
        and(eq(instanceOperations.id, operationId), eq(instanceOperations.status, 'running')),
      );
  }

  async markFailed(operationId: string, failureCode: string, now: Date): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [operation] = await transaction
        .update(instanceOperations)
        .set({ status: 'failed', updatedAt: now, completedAt: now, failureCode })
        .where(
          and(eq(instanceOperations.id, operationId), eq(instanceOperations.status, 'running')),
        )
        .returning({ instanceId: instanceOperations.instanceId, type: instanceOperations.type });
      if (operation?.type === 'spawn') {
        await transaction
          .update(instances)
          .set({ status: 'failed', failureCode, stoppedAt: now, updatedAt: now })
          .where(
            and(
              eq(instances.id, operation.instanceId),
              inArray(instances.status, ['pending', 'provisioning']),
            ),
          );
      }
    });
  }

  async createMaintenanceIntents(now: Date, reconciliationBucket: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const expired = await transaction
        .select({
          id: instances.id,
          userId: instances.userId,
          expiresAt: instances.expiresAt,
        })
        .from(instances)
        .where(
          and(
            inArray(instances.status, ['pending', 'provisioning', 'running']),
            lte(instances.expiresAt, now),
          ),
        );
      for (const instance of expired) {
        const idempotencyKey = `reap-${instance.id}-${instance.expiresAt.getTime()}`;
        await transaction
          .insert(instanceOperations)
          .values({
            instanceId: instance.id,
            userId: instance.userId,
            type: 'reap',
            idempotencyKey,
            requestHash: hash(idempotencyKey),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        await transaction
          .update(instances)
          .set({ status: 'stopping', updatedAt: now })
          .where(
            and(
              eq(instances.id, instance.id),
              inArray(instances.status, ['pending', 'provisioning', 'running']),
            ),
          );
      }

      const active = await transaction
        .select({ id: instances.id, userId: instances.userId })
        .from(instances)
        .where(inArray(instances.status, ['pending', 'provisioning', 'running', 'stopping']));
      for (const instance of active) {
        const idempotencyKey = `reconcile-${reconciliationBucket}`;
        await transaction
          .insert(instanceOperations)
          .values({
            instanceId: instance.id,
            userId: instance.userId,
            type: 'reconcile',
            idempotencyKey,
            requestHash: hash(`${instance.id}:${reconciliationBucket}`),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }
    });
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
