import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  auditEvents,
  challenges,
  instanceOperations,
  instances,
} from './schema.js';
import type {
  InstanceLifecycleRepository,
  InstanceRecord,
  MutationResult,
} from '../services/instance-lifecycle.js';

const activeStatuses = ['pending', 'provisioning', 'running', 'stopping'] as const;
const terminalStatuses = ['stopped', 'failed', 'expired'] as const;

const instanceSelection = {
  id: instances.id,
  userId: instances.userId,
  challengeId: instances.challengeId,
  status: instances.status,
  routeKey: instances.routeKey,
  createdAt: instances.createdAt,
  startedAt: instances.startedAt,
  expiresAt: instances.expiresAt,
  absoluteExpiresAt: instances.absoluteExpiresAt,
  stoppedAt: instances.stoppedAt,
  failureCode: instances.failureCode,
};

export class DrizzleInstanceLifecycleRepository implements InstanceLifecycleRepository {
  constructor(private readonly database: Database) {}

  async createInstanceIntent(input: {
    userId: string;
    challengeId: string;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
    expiresAt: Date;
    absoluteExpiresAt: Date;
    correlationId?: string;
  }): Promise<MutationResult> {
    return this.database.transaction(async (transaction) => {
      await lock(transaction, `operation:${input.userId}:spawn:${input.idempotencyKey}`);
      const replay = await findOperation(
        transaction,
        input.userId,
        'spawn',
        input.idempotencyKey,
      );
      if (replay) return replay.requestHash === input.requestHash
        ? accepted(replay.instance, replay.operationId, true)
        : { kind: 'idempotency_conflict' };

      await lock(transaction, `active-instance:${input.userId}`);
      const [challenge] = await transaction
        .select({ id: challenges.id })
        .from(challenges)
        .where(
          and(
            eq(challenges.id, input.challengeId),
            eq(challenges.published, true),
            eq(challenges.kind, 'web'),
          ),
        )
        .limit(1);
      if (!challenge) return { kind: 'challenge_not_found' };

      const [active] = await transaction
        .select({ id: instances.id })
        .from(instances)
        .where(and(eq(instances.userId, input.userId), inArray(instances.status, activeStatuses)))
        .limit(1);
      if (active) return { kind: 'active_instance_exists' };

      const [instance] = await transaction
        .insert(instances)
        .values({
          userId: input.userId,
          challengeId: input.challengeId,
          createdAt: input.now,
          updatedAt: input.now,
          expiresAt: input.expiresAt,
          absoluteExpiresAt: input.absoluteExpiresAt,
        })
        .returning(instanceSelection);
      if (!instance) throw new Error('Instance insert returned no record');
      const [operation] = await transaction
        .insert(instanceOperations)
        .values({
          instanceId: instance.id,
          userId: input.userId,
          type: 'spawn',
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: instanceOperations.id });
      if (!operation) throw new Error('Operation insert returned no id');
      await appendAudit(transaction, input, 'instance.spawn.requested', instance.id);
      return accepted(instance, operation.id, false);
    });
  }

  async extendInstanceIntent(input: {
    userId: string;
    instanceId: string;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
    extensionMs: number;
    correlationId?: string;
  }): Promise<MutationResult> {
    return this.database.transaction(async (transaction) => {
      await lock(transaction, `operation:${input.userId}:extend:${input.idempotencyKey}`);
      const replay = await findOperation(
        transaction,
        input.userId,
        'extend',
        input.idempotencyKey,
      );
      if (replay) return replay.requestHash === input.requestHash
        ? accepted(replay.instance, replay.operationId, true)
        : { kind: 'idempotency_conflict' };

      await lock(transaction, `instance:${input.instanceId}`);
      const [current] = await transaction
        .select(instanceSelection)
        .from(instances)
        .where(and(eq(instances.id, input.instanceId), eq(instances.userId, input.userId)))
        .limit(1);
      if (!current) return { kind: 'instance_not_found' };
      if (current.status !== 'running' || current.expiresAt <= input.now) {
        return { kind: 'invalid_state' };
      }

      const nextExpiry = new Date(
        Math.min(
          current.expiresAt.getTime() + input.extensionMs,
          current.absoluteExpiresAt.getTime(),
        ),
      );
      if (nextExpiry.getTime() <= current.expiresAt.getTime()) {
        return { kind: 'lifetime_limit' };
      }
      const [instance] = await transaction
        .update(instances)
        .set({ expiresAt: nextExpiry, updatedAt: input.now })
        .where(eq(instances.id, current.id))
        .returning(instanceSelection);
      if (!instance) throw new Error('Instance extension returned no record');
      const [operation] = await transaction
        .insert(instanceOperations)
        .values({
          instanceId: current.id,
          userId: input.userId,
          type: 'extend',
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: instanceOperations.id });
      if (!operation) throw new Error('Operation insert returned no id');
      await appendAudit(transaction, input, 'instance.extend.requested', current.id);
      return accepted(instance, operation.id, false);
    });
  }

  async destroyInstanceIntent(input: {
    userId: string;
    instanceId: string;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
    correlationId?: string;
  }): Promise<MutationResult> {
    return this.database.transaction(async (transaction) => {
      await lock(transaction, `operation:${input.userId}:destroy:${input.idempotencyKey}`);
      const replay = await findOperation(
        transaction,
        input.userId,
        'destroy',
        input.idempotencyKey,
      );
      if (replay) return replay.requestHash === input.requestHash
        ? accepted(replay.instance, replay.operationId, true)
        : { kind: 'idempotency_conflict' };

      await lock(transaction, `instance:${input.instanceId}`);
      const [current] = await transaction
        .select(instanceSelection)
        .from(instances)
        .where(and(eq(instances.id, input.instanceId), eq(instances.userId, input.userId)))
        .limit(1);
      if (!current) return { kind: 'instance_not_found' };
      const terminal = terminalStatuses.includes(current.status as (typeof terminalStatuses)[number]);
      const [instance] = terminal
        ? [current]
        : await transaction
            .update(instances)
            .set({ status: 'stopping', updatedAt: input.now })
            .where(eq(instances.id, current.id))
            .returning(instanceSelection);
      if (!instance) throw new Error('Instance destroy transition returned no record');
      const [operation] = await transaction
        .insert(instanceOperations)
        .values({
          instanceId: current.id,
          userId: input.userId,
          type: 'destroy',
          status: terminal ? 'succeeded' : 'pending',
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          createdAt: input.now,
          updatedAt: input.now,
          completedAt: terminal ? input.now : undefined,
        })
        .returning({ id: instanceOperations.id });
      if (!operation) throw new Error('Operation insert returned no id');
      await appendAudit(transaction, input, 'instance.destroy.requested', current.id);
      return accepted(instance, operation.id, false);
    });
  }

  async findOwnedInstance(userId: string, instanceId: string): Promise<InstanceRecord | null> {
    const [instance] = await this.database
      .select(instanceSelection)
      .from(instances)
      .where(and(eq(instances.id, instanceId), eq(instances.userId, userId)))
      .limit(1);
    return instance ?? null;
  }

  async findOwnedRunningInstance(
    userId: string,
    instanceId: string,
    now: Date,
  ): Promise<{ challengeId: string } | null> {
    const [instance] = await this.database
      .select({ challengeId: instances.challengeId })
      .from(instances)
      .where(
        and(
          eq(instances.id, instanceId),
          eq(instances.userId, userId),
          eq(instances.status, 'running'),
          gt(instances.expiresAt, now),
        ),
      )
      .limit(1);
    return instance ?? null;
  }
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function lock(transaction: Transaction, key: string): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

async function findOperation(
  transaction: Transaction,
  userId: string,
  type: 'spawn' | 'extend' | 'destroy',
  idempotencyKey: string,
) {
  const [record] = await transaction
    .select({
      operationId: instanceOperations.id,
      requestHash: instanceOperations.requestHash,
      ...instanceSelection,
    })
    .from(instanceOperations)
    .innerJoin(instances, eq(instances.id, instanceOperations.instanceId))
    .where(
      and(
        eq(instanceOperations.userId, userId),
        eq(instanceOperations.type, type),
        eq(instanceOperations.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!record) return null;
  const { operationId, requestHash, ...instance } = record;
  return { operationId, requestHash, instance };
}

function accepted(
  instance: InstanceRecord,
  operationId: string,
  replayed: boolean,
): MutationResult {
  return { kind: 'accepted', value: { instance, operationId, replayed } };
}

async function appendAudit(
  transaction: Transaction,
  input: { userId: string; correlationId?: string },
  eventType: string,
  instanceId: string,
): Promise<void> {
  await transaction.insert(auditEvents).values({
    actorUserId: input.userId,
    targetUserId: input.userId,
    eventType,
    correlationId: input.correlationId,
    details: { instanceId },
  });
}
