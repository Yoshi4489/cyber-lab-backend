import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { DockerOrchestrator } from '../src/orchestrator/docker-adapter.js';

const first = '77777777-7777-4777-8777-777777777777';
const second = '88888888-8888-4888-8888-888888888888';
const challenge = '11111111-1111-4111-8111-111111111111';
const resource = (Id: string, instanceId = first, challengeId = challenge) => ({
  Name: `crn-${instanceId.replaceAll('-', '')}`, Names: [`/cr-${instanceId.replaceAll('-', '')}`],
  Id, Labels: { 'cyber-range.managed': 'true', 'cyber-range.instance-id': instanceId, 'cyber-range.challenge-id': challengeId },
});

function fixture() {
  const listContainers = vi.fn(async () => [resource('container')]);
  const listNetworks = vi.fn(async () => [resource('network')]);
  const listInstanceIds = vi.fn(async () => [first]);
  const orchestrator = new DockerOrchestrator({ listContainers, listNetworks } as unknown as Docker, {
    upsert: vi.fn(), remove: vi.fn(), listInstanceIds,
    validateManagedRoute: vi.fn(),
  });
  return { orchestrator, listContainers, listNetworks, listInstanceIds };
}

describe('read-only managed allocation inventory', () => {
  it('counts container, network, and route for one instance as one allocation', async () => {
    const f = fixture();
    expect(await f.orchestrator.inventoryManagedResources()).toEqual({
      allocations: [{ instanceId: first, challengeId: challenge, containerId: 'container', networkId: 'network', routePresent: true }],
      containerIds: ['container'], networkIds: ['network'],
    });
    expect(f.listContainers).toHaveBeenCalledWith({ all: true });
  });

  it('includes network-only, route-only and stopped-container allocations with no database row', async () => {
    const f = fixture();
    f.listNetworks.mockResolvedValue([resource('orphan-network', second)]);
    f.listInstanceIds.mockResolvedValue(['99999999-9999-4999-8999-999999999999']);
    expect((await f.orchestrator.inventoryManagedResources()).allocations).toHaveLength(3);
  });

  it.each(['container', 'network'])('refuses duplicate %s allocations for the same identity', async (kind) => {
    const f = fixture();
    (kind === 'container' ? f.listContainers : f.listNetworks).mockResolvedValue([resource('one'), resource('two')]);
    await expect(f.orchestrator.inventoryManagedResources()).rejects.toThrow('duplicate allocations');
  });

  it('fails closed on missing, malformed or inconsistent ownership labels', async () => {
    for (const invalid of [resource('bad', 'invalid'), resource('bad', first, 'invalid')]) {
      const f = fixture();
      f.listContainers.mockResolvedValue([invalid] as ReturnType<typeof resource>[]);
      await expect(f.orchestrator.inventoryManagedResources()).rejects.toThrow('invalid ownership');
    }
    const f = fixture();
    f.listNetworks.mockResolvedValue([resource('network', first, second)]);
    await expect(f.orchestrator.inventoryManagedResources()).rejects.toThrow('inconsistent challenge');
  });

  it('preserves unrelated resource IDs as absence evidence and rejects stripped labels on reserved names', async () => {
    const f = fixture();
    f.listContainers.mockResolvedValue([{ Id: 'unrelated', Labels: {} }] as ReturnType<typeof resource>[]);
    const snapshot = await f.orchestrator.inventoryManagedResources();
    expect(snapshot.containerIds).toEqual(['unrelated']);
    expect(snapshot.allocations[0]?.containerId).toBeNull();
    f.listContainers.mockResolvedValue([{
      Id: 'stripped', Labels: {}, Names: [`/cr-${first.replaceAll('-', '')}`],
    }] as unknown as ReturnType<typeof resource>[]);
    await expect(f.orchestrator.inventoryManagedResources()).rejects.toThrow('missing ownership labels');
  });

  it('fails closed if trusted ingress is accidentally labeled as a lab target', async () => {
    const f = fixture();
    f.listContainers.mockResolvedValue([{
      ...resource('ingress'), Names: ['/traefik'],
    }] as unknown as ReturnType<typeof resource>[]);
    const orchestrator = new DockerOrchestrator({ listContainers: f.listContainers, listNetworks: f.listNetworks } as unknown as Docker, {
      upsert: vi.fn(), remove: vi.fn(), listInstanceIds: f.listInstanceIds,
      validateManagedRoute: vi.fn(),
    }, 'traefik');
    await expect(orchestrator.inventoryManagedResources()).rejects.toThrow('Trusted ingress');
  });

  it.each(['docker', 'route'])('propagates %s inventory failures instead of returning an incomplete count', async (dependency) => {
    const f = fixture();
    (dependency === 'docker' ? f.listContainers : f.listInstanceIds).mockRejectedValueOnce(new Error('inventory unavailable'));
    await expect(f.orchestrator.inventoryManagedResources()).rejects.toThrow('inventory unavailable');
  });
});
