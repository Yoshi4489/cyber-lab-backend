import type { RuntimeInstanceState } from './lifecycle-state.js';
import type { ManagedRuntimeAllocation, ManagedRuntimeInventory } from './runtime-inventory.js';

export type CleanupIntent = {
  instanceId: string;
  nodeId: string;
  reason: 'missing' | 'terminal';
  allocation: ManagedRuntimeAllocation;
  record: RuntimeInstanceState | null;
};

export type ManagedCleanupRepository = {
  readSnapshot(nodeId: string, observedIds: readonly string[]): Promise<RuntimeInstanceState[]>;
  beginCleanup(intents: readonly CleanupIntent[], now: Date): Promise<void>;
  completeCleanup(intents: readonly CleanupIntent[], now: Date): Promise<void>;
  recordCleanupFailure(intents: readonly CleanupIntent[], now: Date): Promise<void>;
};

export type ManagedCleanupRuntime = {
  inventoryManagedResources(): Promise<ManagedRuntimeInventory>;
  prepareManagedCleanup(allocations: readonly ManagedRuntimeAllocation[]): Promise<Array<() => Promise<void>>>;
};

export class ManagedResourceSweeper {
  constructor(
    private readonly repository: ManagedCleanupRepository,
    private readonly runtime: ManagedCleanupRuntime,
    private readonly nodeId: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async sweep(): Promise<void> {
    const inventory = await this.runtime.inventoryManagedResources();
    const records = await this.repository.readSnapshot(this.nodeId, inventory.allocations.map(({ instanceId }) => instanceId));
    const intents = buildCleanupPlan(this.nodeId, inventory, records);
    if (!intents.length) return;
    // Validate every Engine resource and route before any audit or destructive call.
    const cleanup = await this.runtime.prepareManagedCleanup(intents.map(({ allocation }) => allocation));
    await this.repository.beginCleanup(intents, this.clock());
    try {
      for (const remove of cleanup) await remove();
      const remaining = await this.runtime.inventoryManagedResources();
      if (intents.some((intent) => resourcesRemain(intent, remaining))) {
        throw new Error('Managed resources remain after orphan cleanup');
      }
      await this.repository.completeCleanup(intents, this.clock());
    } catch {
      await this.repository.recordCleanupFailure(intents, this.clock());
      throw new Error('Managed resource cleanup failed; capacity is retained for retry');
    }
  }
}

function buildCleanupPlan(
  nodeId: string,
  inventory: ManagedRuntimeInventory,
  records: readonly RuntimeInstanceState[],
): CleanupIntent[] {
  const observed = new Map(inventory.allocations.map((allocation) => [allocation.instanceId, allocation]));
  const rows = new Map(records.map((record) => [record.id, record]));
  // Validate the complete snapshot first, including active instances we will preserve.
  for (const record of records) {
    const allocation = observed.get(record.id);
    if (allocation && record.nodeId && record.nodeId !== nodeId) throw new Error('Managed allocation belongs to a different node');
    if (allocation?.challengeId && allocation.challengeId !== record.challengeId) throw new Error('Managed allocation challenge differs from persisted intent');
    if ((record.containerId && inventory.containerIds.includes(record.containerId) && allocation?.containerId !== record.containerId) ||
      (record.networkId && inventory.networkIds.includes(record.networkId) && allocation?.networkId !== record.networkId)) {
      throw new Error('Persisted runtime resource has missing or mismatched ownership labels');
    }
  }
  const intents: CleanupIntent[] = [];
  for (const allocation of inventory.allocations) {
    const record = rows.get(allocation.instanceId) ?? null;
    if (record && !isTerminal(record.status)) continue;
    intents.push({ instanceId: allocation.instanceId, nodeId, reason: record ? 'terminal' : 'missing', allocation, record });
  }
  for (const record of records) {
    if (record.nodeId !== nodeId || !isTerminal(record.status) || observed.has(record.id)) continue;
    intents.push({ instanceId: record.id, nodeId, reason: 'terminal', record,
      allocation: { instanceId: record.id, challengeId: record.challengeId, containerId: null, networkId: null, routePresent: false } });
  }
  return intents;
}

function isTerminal(status: string): boolean {
  return ['stopped', 'failed', 'expired'].includes(status);
}

function resourcesRemain(intent: CleanupIntent, inventory: ManagedRuntimeInventory): boolean {
  return inventory.allocations.some(({ instanceId }) => instanceId === intent.instanceId) ||
    [intent.allocation.containerId, intent.record?.containerId].some((id) => id && inventory.containerIds.includes(id)) ||
    [intent.allocation.networkId, intent.record?.networkId].some((id) => id && inventory.networkIds.includes(id));
}
