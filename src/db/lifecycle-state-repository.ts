import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { auditEvents, instances, labNodes } from './schema.js';
import type {
  LifecycleStateRepository,
  RuntimeInstanceState,
} from '../services/lifecycle-state.js';
import type { ManagedRuntimeInventory } from '../services/runtime-inventory.js';

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

  async registerNode(name: string, capacitySlots: number, now: Date): Promise<string> {
    if (!Number.isInteger(capacitySlots) || capacitySlots < 1 || capacitySlots > 2_147_483_647) {
      throw new Error('Node capacity must be a positive integer');
    }
    const [node] = await this.database
      .insert(labNodes)
      .values({ name, capacitySlots, status: 'active', lastSeenAt: now, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: labNodes.name,
        set: { capacitySlots, status: 'active', lastSeenAt: now, updatedAt: now },
      })
      .returning({ id: labNodes.id });
    if (!node) throw new Error('Node registration returned no id');
    return node.id;
  }

  async prepareSpawn(input: {
    instanceId: string;
    nodeId: string;
    routeKey: string;
    inventory: ManagedRuntimeInventory;
    now: Date;
  }): Promise<RuntimeInstanceState | null> {
    return this.database.transaction(async (transaction) => {
      // Admission is serialized for the whole node, not only the requesting instance.
      const [node] = await transaction.select().from(labNodes)
        .where(eq(labNodes.id, input.nodeId)).for('update');
      if (!node || node.status !== 'active') throw new Error('Lab node is unavailable');
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

      if (current.nodeId && current.nodeId !== input.nodeId) {
        throw new Error('Instance reservation belongs to another node');
      }
      const observed = new Map(input.inventory.allocations.map((allocation) => [allocation.instanceId, allocation]));
      const currentAllocation = observed.get(current.id);
      if (currentAllocation?.challengeId && currentAllocation.challengeId !== current.challengeId) {
        throw new Error('Managed runtime ownership differs from its persisted reservation');
      }
      const reservations = await transaction.select(selection).from(instances)
        .where(eq(instances.nodeId, input.nodeId));
      const occupied = new Set(observed.keys());
      for (const reservation of reservations) {
        const allocation = observed.get(reservation.id);
        const mislabeled = (reservation.containerId !== null &&
          input.inventory.containerIds.includes(reservation.containerId) && allocation?.containerId !== reservation.containerId) ||
          (reservation.networkId !== null && input.inventory.networkIds.includes(reservation.networkId) &&
            allocation?.networkId !== reservation.networkId);
        if (mislabeled || (allocation?.challengeId && allocation.challengeId !== reservation.challengeId)) {
          throw new Error('Managed runtime ownership differs from its persisted reservation');
        }
        const terminal = ['stopped', 'failed', 'expired'].includes(reservation.status);
        if (terminal && !observed.has(reservation.id)) {
          // Release only after a complete inventory confirms all managed resources absent.
          await transaction.update(instances).set({
            nodeId: null, containerId: null, networkId: null, routeKey: null, updatedAt: input.now,
          }).where(eq(instances.id, reservation.id));
        } else {
          occupied.add(reservation.id);
        }
      }
      // A retry reuses its durable reservation even if the configured limit was reduced.
      if (!occupied.has(current.id) && occupied.size >= node.capacitySlots) {
        await transaction.update(instances).set({
          status: 'failed', failureCode: 'node_capacity_exhausted',
          stoppedAt: input.now, updatedAt: input.now,
        }).where(eq(instances.id, current.id));
        await transaction.insert(auditEvents).values({
          targetUserId: current.userId, eventType: 'instance.capacity_refused',
          details: { instanceId: current.id, failureCode: 'node_capacity_exhausted' },
          createdAt: input.now,
        });
        return null;
      }

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
    await this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ status: instances.status, userId: instances.userId })
        .from(instances)
        .where(eq(instances.id, instanceId))
        .for('update');
      await transaction
        .update(instances)
        .set({
          status,
          nodeId: null,
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
      // Retried operations re-clear the row; only the first transition is audited.
      if (current && ['pending', 'provisioning', 'running', 'stopping'].includes(current.status)) {
        await transaction.insert(auditEvents).values({
          targetUserId: current.userId,
          eventType: `instance.${status}`,
          details: { instanceId },
          createdAt: now,
        });
      }
    });
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
