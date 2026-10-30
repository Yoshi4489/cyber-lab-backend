import { randomUUID } from 'node:crypto';
import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { DockerOrchestrator } from '../src/orchestrator/docker-adapter.js';
import type { ManagedRuntimeAllocation } from '../src/services/runtime-inventory.js';

const challengeId = randomUUID();
function fixture() {
  const allocations: ManagedRuntimeAllocation[] = [randomUUID(), randomUUID()].map((instanceId) => ({
    instanceId, challengeId, containerId: `container-${instanceId}`, networkId: `network-${instanceId}`, routePresent: true,
  }));
  const inspectContainer = vi.fn(async (id: string) => {
    if (id === 'traefik') return { Id: 'trusted-ingress-id', Name: '/traefik', Config: { Labels: {} } };
    const allocation = allocations.find(({ containerId }) => containerId === id)!;
    return { Id: id, Name: `/cr-${allocation.instanceId.replaceAll('-', '')}`, Config: { Labels: labels(allocation.instanceId) } };
  });
  const inspectNetwork = vi.fn(async (id: string) => {
    const allocation = allocations.find(({ networkId }) => networkId === id)!;
    return { Id: id, Name: `crn-${allocation.instanceId.replaceAll('-', '')}`, Labels: labels(allocation.instanceId),
      Containers: { 'trusted-ingress-id': { Name: 'traefik' }, 'unrelated-endpoint': { Name: 'unrelated' } } };
  });
  const stop = vi.fn(async () => undefined);
  const removeContainer = vi.fn(async () => undefined);
  const removeNetwork = vi.fn(async () => undefined);
  const disconnect = vi.fn(async () => undefined);
  const router = { upsert: vi.fn(), remove: vi.fn(async () => undefined), listInstanceIds: vi.fn(async () => []), validateManagedRoute: vi.fn(async () => undefined) };
  const docker = {
    getContainer: (id: string) => ({ inspect: () => inspectContainer(id), stop, remove: removeContainer }),
    getNetwork: (id: string) => ({ inspect: () => inspectNetwork(id), disconnect, remove: removeNetwork }),
  } as unknown as Docker;
  return { allocations, inspectContainer, inspectNetwork, stop, removeContainer, removeNetwork, disconnect, router,
    orchestrator: new DockerOrchestrator(docker, router, 'traefik') };
}
function labels(instanceId: string) {
  return { 'cyber-range.managed': 'true', 'cyber-range.instance-id': instanceId, 'cyber-range.challenge-id': challengeId };
}

describe('prepared orphan cleanup ownership', () => {
  it('validates all candidates before any destructive call, and detaches only actual trusted ingress', async () => {
    const f = fixture();
    const cleanup = await f.orchestrator.prepareManagedCleanup(f.allocations);
    expect(f.router.remove).not.toHaveBeenCalled();
    expect(f.stop).not.toHaveBeenCalled();
    expect(f.router.validateManagedRoute).toHaveBeenCalledTimes(2);
    for (const remove of cleanup) await remove();
    expect(f.removeContainer).toHaveBeenCalledTimes(2);
    expect(f.removeNetwork).toHaveBeenCalledTimes(2);
    expect(f.disconnect.mock.calls).toEqual([[{ Container: 'trusted-ingress-id', Force: true }], [{ Container: 'trusted-ingress-id', Force: true }]]);
  });

  it.each(['read', 'labels', 'name', 'challenge', 'route'] as const)('aborts all candidates before removal for a later %s failure', async (failure) => {
    const f = fixture();
    const original = f.inspectNetwork.getMockImplementation()!;
    f.inspectNetwork.mockImplementation(async (id) => {
      const result = await original(id);
      if (id !== f.allocations[1]?.networkId) return result;
      if (failure === 'read') throw new Error('network inventory unavailable');
      if (failure === 'labels') result.Labels['cyber-range.instance-id'] = randomUUID();
      if (failure === 'name') result.Name = 'unrelated-network';
      if (failure === 'challenge') result.Labels['cyber-range.challenge-id'] = randomUUID();
      return result;
    });
    if (failure === 'route') f.router.validateManagedRoute.mockImplementation(async (id?: unknown) => {
      if (id === f.allocations[1]?.instanceId) throw new Error('unrelated route contents');
    });
    await expect(f.orchestrator.prepareManagedCleanup(f.allocations)).rejects.toThrow();
    expect(f.router.remove).not.toHaveBeenCalled();
    expect(f.removeContainer).not.toHaveBeenCalled();
    expect(f.removeNetwork).not.toHaveBeenCalled();
  });

  it('refuses to delete actual trusted ingress even if it has target labels', async () => {
    const f = fixture();
    const original = f.inspectContainer.getMockImplementation()!;
    f.inspectContainer.mockImplementation(async (id) => {
      const result = await original(id);
      return id === 'traefik' ? result : { ...result, Id: 'trusted-ingress-id' };
    });
    await expect(f.orchestrator.prepareManagedCleanup(f.allocations)).rejects.toThrow('trusted ingress');
    expect(f.router.remove).not.toHaveBeenCalled();
    expect(f.removeContainer).not.toHaveBeenCalled();
  });

  it('leaves unrelated network endpoints attached when removal fails for retry', async () => {
    const f = fixture();
    f.removeNetwork.mockRejectedValueOnce(new Error('active endpoints remain'));
    const cleanup = await f.orchestrator.prepareManagedCleanup([f.allocations[0]!]);
    await expect(cleanup[0]!()).rejects.toThrow('active endpoints remain');
    expect(f.disconnect).toHaveBeenCalledExactlyOnceWith({ Container: 'trusted-ingress-id', Force: true });
    expect(f.disconnect).not.toHaveBeenCalledWith(expect.objectContaining({ Container: 'unrelated-endpoint' }));
  });
});
