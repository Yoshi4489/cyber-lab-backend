import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { auditEvents, instances, labNodes } from './schema.js';
import type {
  LifecycleStateRepository,
  RuntimeInstanceState,
} from '../services/lifecycle-state.js';

const selection = {
  id: instances.id,
  userId: instances.userId,
  challengeId: instances.challengeId,
  status: instances.status,
  nodeId: instances.nodeId,
  routeKey: instances.routeKey,
  containerId: instances.containerId,
  networkId: instances.networkId,
  expiresAt: instances.expiresAt,
};

export class DrizzleLifecycleStateRepository implements LifecycleStateRepository {
  constructor(private readonly database: Database) {}

  async registerNode(name: string, now: Date): Promise<string> {
    const [node] = await this.database
      .insert(labNodes)
      .values({ name, status: 'active', lastSeenAt: now, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: labNodes.name,
        set: { status: 'active', lastSeenAt: now, updatedAt: now },
      })
      .returning({ id: labNodes.id });
    if (!node) throw new Error('Node registration returned no id');
    return node.id;
  }

  async prepareSpawn(input: {
    instanceId: string;
    nodeId: string;
    routeKey: string;
    now: Date;
  }): Promise<RuntimeInstanceState | null> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`instance:${input.instanceId}`}))`,
      );
      const [current] = await transaction
        .select(selection)
        .from(instances)
        .where(eq(instances.id, input.instanceId))
        .limit(1);
      if (!current) return null;
      if (current.status === 'running') return current;
      if (current.status !== 'pending' && current.status !== 'provisioning') return null;

      const [prepared] = await transaction
        .update(instances)
        .set({
          status: 'provisioning',
          nodeId: input.nodeId,
          routeKey: current.routeKey ?? input.routeKey,
          updatedAt: input.now,
        })
        .where(eq(instances.id, input.instanceId))
        .returning(selection);
      return prepared ?? null;
    });
  }

  async completeSpawn(input: {
    instanceId: string;
    containerId: string;
    networkId: string;
    now: Date;
  }): Promise<boolean> {
    const [running] = await this.database
      .update(instances)
      .set({
        status: 'running',
        containerId: input.containerId,
        networkId: input.networkId,
        startedAt: sql`coalesce(${instances.startedAt}, ${input.now})`,
        failureCode: null,
        updatedAt: input.now,
      })
      .where(and(eq(instances.id, input.instanceId), eq(instances.status, 'provisioning')))
      .returning({ id: instances.id });
    if (running) return true;

    const [existing] = await this.database
      .select({ status: instances.status })
      .from(instances)
      .where(eq(instances.id, input.instanceId))
      .limit(1);
    return existing?.status === 'running';
  }

  async completeStop(
    instanceId: string,
    status: 'stopped' | 'expired',
    now: Date,
  ): Promise<void> {
    await this.database
      .update(instances)
      .set({
        status,
        routeKey: null,
        containerId: null,
        networkId: null,
        stoppedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(instances.id, instanceId),
          inArray(instances.status, ['pending', 'provisioning', 'running', 'stopping', status]),
        ),
      );
  }

  async markInstanceFailed(instanceId: string, failureCode: string, now: Date): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [failed] = await transaction
        .update(instances)
        .set({ status: 'failed', failureCode, updatedAt: now, stoppedAt: now })
        .where(and(
          eq(instances.id, instanceId),
          inArray(instances.status, ['pending', 'provisioning', 'running']),
        ))
        .returning({ userId: instances.userId });
      if (failed) {
        await transaction.insert(auditEvents).values({
          targetUserId: failed.userId,
          eventType: 'instance.runtime_terminated',
          details: { instanceId, failureCode },
          createdAt: now,
        });
      }
    });
  }

  async findInstance(instanceId: string): Promise<RuntimeInstanceState | null> {
    const [instance] = await this.database
      .select(selection)
      .from(instances)
      .where(eq(instances.id, instanceId))
      .limit(1);
    return instance ?? null;
  }
}
