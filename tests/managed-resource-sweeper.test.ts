import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ManagedResourceSweeper, type ManagedCleanupRepository } from '../src/services/managed-resource-cleanup.js';
import type { RuntimeInstanceState } from '../src/services/lifecycle-state.js';
import type { ManagedRuntimeAllocation, ManagedRuntimeInventory } from '../src/services/runtime-inventory.js';

const nodeId = randomUUID();
const challengeId = randomUUID();
const allocation = (instanceId = randomUUID()): ManagedRuntimeAllocation => ({
  instanceId, challengeId, containerId: `container-${instanceId}`, networkId: `network-${instanceId}`, routePresent: true,
});
const record = (resource: ManagedRuntimeAllocation, status: RuntimeInstanceState['status'] = 'failed'): RuntimeInstanceState => ({
  id: resource.instanceId, userId: randomUUID(), challengeId, status, nodeId, routeKey: 'safe-route-key',
  containerId: resource.containerId, networkId: resource.networkId, expiresAt: new Date(),
});

function fixture(resources = [allocation()], records: RuntimeInstanceState[] = []) {
  let remaining = [...resources];
  const snapshot = (): ManagedRuntimeInventory => ({ allocations: [...remaining],
    containerIds: ['unrelated-container', ...remaining.flatMap(({ containerId }) => containerId ? [containerId] : [])],
    networkIds: ['unrelated-network', ...remaining.flatMap(({ networkId }) => networkId ? [networkId] : [])] });
  const remove = vi.fn(async (id: string) => { remaining = remaining.filter(({ instanceId }) => instanceId !== id); });
  const repository = {
    readSnapshot: vi.fn(async () => records), beginCleanup: vi.fn(async () => undefined),
    completeCleanup: vi.fn<ManagedCleanupRepository['completeCleanup']>(async (intents) => {
      for (const intent of intents) {
        const row = records.find(({ id }) => id === intent.instanceId);
        if (row) Object.assign(row, { nodeId: null, containerId: null, networkId: null, routeKey: null });
      }
    }),
    recordCleanupFailure: vi.fn(async () => undefined),
  };
  const runtime = {
    inventoryManagedResources: vi.fn(async () => snapshot()),
    prepareManagedCleanup: vi.fn(async (allocations: readonly ManagedRuntimeAllocation[]) => allocations.map(
      ({ instanceId }) => () => remove(instanceId),
    )),
  };
  return { repository, runtime, remove, sweeper: new ManagedResourceSweeper(repository, runtime, nodeId) };
}

describe('managed orphan sweeps', () => {
  it('cleans missing and terminal allocations, preserves active targets, and repeats harmlessly', async () => {
    const resources = Array.from({ length: 5 }, () => allocation());
    const rows = resources.slice(1).map((resource, index) => record(resource, (['stopped', 'failed', 'expired', 'running'] as const)[index]));
    const f = fixture(resources, rows);
    await f.sweeper.sweep();
    expect(f.remove.mock.calls.map(([id]) => id)).toEqual(resources.slice(0, 4).map(({ instanceId }) => instanceId));
    expect(f.repository.beginCleanup).toHaveBeenCalledBefore(f.remove);
    expect(f.repository.completeCleanup).toHaveBeenCalledOnce();
    expect(rows.slice(0, 3).every(({ nodeId }) => nodeId === null)).toBe(true);
    expect(rows[3]?.nodeId).toBe(nodeId);
    await f.sweeper.sweep();
    expect(f.remove).toHaveBeenCalledTimes(4);
    expect(f.repository.completeCleanup).toHaveBeenCalledOnce();
  });

  it.each(['containerId', 'networkId', 'routePresent'] as const)('cleans a partial orphan containing only %s', async (kind) => {
    const resource: ManagedRuntimeAllocation = { instanceId: randomUUID(), challengeId: null, containerId: null, networkId: null, routePresent: false };
    if (kind === 'routePresent') resource.routePresent = true;
    else { resource[kind] = `partial-${kind}`; resource.challengeId = challengeId; }
    const f = fixture([resource]);
    await f.sweeper.sweep();
    expect(f.remove).toHaveBeenCalledOnce();
    expect(f.repository.completeCleanup).toHaveBeenCalledOnce();
  });

  it.each(['inventory', 'database', 'validation', 'audit'] as const)('performs no destructive calls when %s evidence is unavailable', async (failure) => {
    const f = fixture([allocation(), allocation()]);
    const failed = { inventory: f.runtime.inventoryManagedResources, database: f.repository.readSnapshot,
      validation: f.runtime.prepareManagedCleanup, audit: f.repository.beginCleanup }[failure];
    failed.mockRejectedValueOnce(new Error('unavailable'));
    await expect(f.sweeper.sweep()).rejects.toThrow('unavailable');
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.repository.completeCleanup).not.toHaveBeenCalled();
  });

  it.each(['other_node', 'challenge', 'stripped_labels'] as const)('rejects an ambiguous %s snapshot before cleanup of any candidate', async (mismatch) => {
    const orphan = allocation();
    const active = allocation();
    const row = record(active, 'running');
    if (mismatch === 'other_node') row.nodeId = randomUUID();
    if (mismatch === 'challenge') row.challengeId = randomUUID();
    if (mismatch === 'stripped_labels') row.containerId = 'unrelated-container';
    const f = fixture([orphan, active], [row]);
    await expect(f.sweeper.sweep()).rejects.toThrow();
    expect(f.runtime.prepareManagedCleanup).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  });

  it('audits partial failure without releasing capacity and retries the remaining resources', async () => {
    const first = allocation();
    const second = allocation();
    const rows = [record(first), record(second)];
    const f = fixture([first, second], rows);
    const implementation = f.remove.getMockImplementation()!;
    f.remove.mockImplementationOnce(implementation).mockRejectedValueOnce(new Error('sensitive provider details'));
    await expect(f.sweeper.sweep()).rejects.toThrow('capacity is retained');
    expect(f.repository.completeCleanup).not.toHaveBeenCalled();
    expect(rows.every((row) => row.nodeId === nodeId)).toBe(true);
    expect(f.repository.recordCleanupFailure).toHaveBeenCalledOnce();
    await f.sweeper.sweep();
    expect(f.repository.completeCleanup).toHaveBeenCalledOnce();
    expect(rows.every((row) => row.nodeId === null)).toBe(true);
  });

  it('does not release capacity when post-cleanup inventory fails or reports resources remaining', async () => {
    for (const unreadable of [true, false]) {
      const resource = allocation();
      const row = record(resource);
      const f = fixture([resource], [row]);
      if (unreadable) f.runtime.inventoryManagedResources.mockImplementationOnce(async () => ({
        allocations: [resource], containerIds: [resource.containerId!], networkIds: [resource.networkId!],
      })).mockRejectedValueOnce(new Error('confirmation unavailable'));
      else f.remove.mockResolvedValueOnce(undefined);
      await expect(f.sweeper.sweep()).rejects.toThrow('capacity is retained');
      expect(f.repository.completeCleanup).not.toHaveBeenCalled();
      expect(row.nodeId).toBe(nodeId);
    }
  });
});
