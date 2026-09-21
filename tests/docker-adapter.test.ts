import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { DockerOrchestrator } from '../src/orchestrator/docker-adapter.js';
import {
  RuntimeManifestRegistry,
  type RuntimeManifest,
} from '../src/orchestrator/runtime-manifests.js';
import type { TraefikRouter } from '../src/orchestrator/traefik-router.js';

const INSTANCE_ID = '77777777-7777-4777-8777-777777777777';
const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE_KEY = 'abcdefghijklmnopqrstuvwx12345678';
const IMAGE = `registry.example.test/range/web@sha256:${'a'.repeat(64)}`;

const manifest: RuntimeManifest = {
  challengeId: CHALLENGE_ID,
  image: IMAGE,
  containerPort: 8080,
  user: '65532:65532',
  healthcheck: {
    test: ['CMD', '/app/healthcheck'],
    intervalSeconds: 5,
    timeoutSeconds: 3,
    retries: 5,
    startupSeconds: 5,
  },
  resources: { memoryMb: 128, cpuCores: 0.5, pids: 64, tmpfsMb: 16 },
};

describe('trusted runtime manifests', () => {
  it('accepts pinned images and rejects mutable tags or duplicate challenges', () => {
    expect(new RuntimeManifestRegistry([manifest]).get(CHALLENGE_ID)).toEqual(manifest);
    expect(() => new RuntimeManifestRegistry([{ ...manifest, image: 'nginx:latest' }])).toThrow(
      'Runtime images must use a sha256 digest or image id',
    );
    expect(() => new RuntimeManifestRegistry([manifest, manifest])).toThrow(
      'Duplicate runtime manifest',
    );
  });
});

describe('Docker orchestrator', () => {
  it('constructs a restricted target without host ports or control-plane mounts', async () => {
    const fixture = dockerFixture();
    const router = routerFixture();
    const orchestrator = new DockerOrchestrator(fixture.docker, router);

    await expect(orchestrator.spawn(spawnInput())).resolves.toEqual({
      containerId: 'container-id',
      networkId: 'network-id',
    });

    expect(fixture.createNetwork).toHaveBeenCalledWith(expect.objectContaining({
      Internal: true,
      Attachable: false,
    }));
    const options = fixture.createContainer.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      Image: IMAGE,
      User: '65532:65532',
      Env: ['CYBER_RANGE_FLAG=CTF{test-only}'],
      HostConfig: {
        AutoRemove: false,
        CapDrop: ['ALL'],
        Memory: 128 * 1_024 * 1_024,
        NanoCpus: 500_000_000,
        NetworkMode: `crn-${INSTANCE_ID.replaceAll('-', '')}`,
        PidsLimit: 64,
        Privileged: false,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true', 'seccomp=default', 'apparmor=docker-default'],
      },
    });
    expect(options?.HostConfig).not.toHaveProperty('PortBindings');
    expect(options?.HostConfig).not.toHaveProperty('Binds');
    expect(options?.HostConfig).not.toHaveProperty('Devices');
    expect(router.upsert).toHaveBeenCalledOnce();
  });

  it('cleans the container and network after a partial start failure', async () => {
    const fixture = dockerFixture({ startError: new Error('start failed') });
    const router = routerFixture();
    const orchestrator = new DockerOrchestrator(fixture.docker, router);

    await expect(orchestrator.spawn(spawnInput())).rejects.toThrow('start failed');
    expect(router.remove).toHaveBeenCalledWith(INSTANCE_ID);
    expect(fixture.containerRemove).toHaveBeenCalledWith({ force: true, v: true });
    expect(fixture.networkRemove).toHaveBeenCalledOnce();
  });

  it('fails closed when the Docker host lacks a required isolation control', async () => {
    const fixture = dockerFixture({ securityOptions: ['name=seccomp', 'name=apparmor'] });
    const orchestrator = new DockerOrchestrator(fixture.docker, routerFixture());

    await expect(orchestrator.spawn(spawnInput())).rejects.toThrow(
      'Docker host is missing required userns isolation',
    );
    expect(fixture.createContainer).not.toHaveBeenCalled();
  });
});

function spawnInput() {
  return {
    instanceId: INSTANCE_ID,
    challengeId: CHALLENGE_ID,
    routeKey: ROUTE_KEY,
    flag: 'CTF{test-only}',
    manifest,
  };
}

function routerFixture(): TraefikRouter & {
  upsert: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    upsert: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
}

function dockerFixture(options: {
  startError?: Error;
  securityOptions?: string[];
} = {}) {
  const containerRemove = vi.fn(async () => undefined);
  const networkRemove = vi.fn(async () => undefined);
  const container = {
    id: 'container-id',
    start: vi.fn(async () => {
      if (options.startError) throw options.startError;
    }),
    stop: vi.fn(async () => undefined),
    remove: containerRemove,
    inspect: vi.fn(async () => ({ State: { Running: true, Health: { Status: 'healthy' } } })),
  };
  const network = {
    id: 'network-id',
    connect: vi.fn(async () => undefined),
    remove: networkRemove,
  };
  const createContainer = vi.fn(async (_options: Docker.ContainerCreateOptions) => container);
  const createNetwork = vi.fn(async (_options: Docker.NetworkCreateOptions) => network);
  const docker = {
    info: vi.fn(async () => ({
      SecurityOptions: options.securityOptions ?? [
        'name=userns',
        'name=seccomp,profile=default',
        'name=apparmor',
      ],
    })),
    listContainers: vi.fn(async () => []),
    listNetworks: vi.fn(async () => []),
    createContainer,
    createNetwork,
    getContainer: vi.fn(() => container),
    getNetwork: vi.fn(() => network),
  };
  return {
    docker: docker as unknown as Docker,
    createContainer,
    createNetwork,
    containerRemove,
    networkRemove,
  };
}
