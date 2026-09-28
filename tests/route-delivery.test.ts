import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { createRouteDelivery } from '../src/orchestrator/route-delivery.js';
import { loadWorkerConfig } from '../src/worker-config.js';

const instanceId = '77777777-7777-4777-8777-777777777777';
const routeKey = 'abcdefghijklmnopqrstuvwx12345678';
const route = { instanceId, routeKey, targetHost: 'cr-target', targetPort: 8080 };
const containerDirectory = '/etc/traefik/dynamic';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://example.test/range',
  REDIS_URL: 'redis://example.test:6379',
  INSTANCE_FLAG_SECRET: 'worker-flag-secret-at-least-thirty-two-characters',
  RUNTIME_MANIFEST_PATH: '/run/config/manifests.json',
  LAB_INGRESS_CONTAINER: 'traefik',
  DOCKER_SOCKET_PATH: '/var/run/docker.sock',
};

describe('route delivery selection', () => {
  it('sends routes over Docker and never beside the worker in ingress mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cyber-range-delivery-'));
    try {
      const ingress = ingressFixture();
      const delivery = createRouteDelivery(ingress.docker, loadWorkerConfig({
        ...base,
        TRAEFIK_ROUTE_DELIVERY: 'ingress',
        TRAEFIK_CONTAINER_DYNAMIC_DIRECTORY: containerDirectory,
        TRAEFIK_DYNAMIC_DIRECTORY: directory,
      }));

      await delivery.router.upsert(route);
      expect(ingress.files.has(`${containerDirectory}/lab-77777777777747778777777777777777.yml`))
        .toBe(true);
      expect(await readdir(directory)).toEqual([]);

      await expect(delivery.verify()).resolves.toBeUndefined();
      await delivery.router.remove(instanceId);
      expect(ingress.files.size).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes beside the worker and skips the probe when no ingress directory is configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cyber-range-delivery-'));
    try {
      const docker = { getContainer: vi.fn() } as unknown as Docker;
      const delivery = createRouteDelivery(docker, loadWorkerConfig({
        ...base,
        TRAEFIK_DYNAMIC_DIRECTORY: directory,
      }));

      await delivery.router.upsert(route);
      expect(await readdir(directory)).toEqual(['lab-77777777777747778777777777777777.yml']);
      await expect(delivery.verify()).resolves.toBeUndefined();
      expect(docker.getContainer).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('probes ingress visibility when file delivery has an ingress directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cyber-range-delivery-'));
    try {
      const getArchive = vi.fn(async ({ path }: { path: string }) => {
        const marker = await readFile(join(directory, basename(path)));
        return Readable.from([Buffer.alloc(512), marker, Buffer.alloc(512)]);
      });
      const docker = { getContainer: vi.fn(() => ({ getArchive })) } as unknown as Docker;
      const delivery = createRouteDelivery(docker, loadWorkerConfig({
        ...base,
        TRAEFIK_DYNAMIC_DIRECTORY: directory,
        TRAEFIK_CONTAINER_DYNAMIC_DIRECTORY: containerDirectory,
      }));

      await expect(delivery.verify()).resolves.toBeUndefined();
      expect(docker.getContainer).toHaveBeenCalledWith('traefik');
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function ingressFixture() {
  const files = new Map<string, string>();
  const putArchive = vi.fn(async (tar: Buffer, { path }: { path: string }) => {
    const name = tar.subarray(0, 100).toString('utf8').split('\0')[0]!;
    const size = parseInt(tar.subarray(124, 136).toString('ascii').split('\0')[0]!.trim(), 8);
    files.set(`${path}/${name}`, tar.subarray(512, 512 + size).toString('utf8'));
    return Readable.from([]) as unknown as NodeJS.ReadWriteStream;
  });
  const getArchive = vi.fn(async ({ path }: { path: string }) => {
    const contents = files.get(path);
    if (contents === undefined) throw Object.assign(new Error('no such file'), { statusCode: 404 });
    return Readable.from([Buffer.alloc(512), Buffer.from(contents, 'utf8')]);
  });
  const exec = vi.fn(async ({ Cmd }: { Cmd?: string[] }) => {
    const target = Cmd?.[3];
    return {
      start: async () => {
        if (target) files.delete(target);
        return Readable.from([]);
      },
      inspect: async () => ({ ExitCode: 0 }),
    };
  });
  const docker = {
    getContainer: vi.fn(() => ({ putArchive, getArchive, exec })),
  } as unknown as Docker;
  return { docker, files, putArchive, getArchive, exec };
}
