import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { FileTraefikRouter } from '../src/orchestrator/traefik-router.js';

const instanceId = '77777777-7777-4777-8777-777777777777';
const routeKey = 'abcdefghijklmnopqrstuvwx12345678';

describe('Traefik file routes', () => {
  it('writes a supported YAML route and removes it with the instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cyber-range-traefik-'));
    try {
      const router = new FileTraefikRouter(directory);
      await router.upsert({ instanceId, routeKey, targetHost: 'cr-target', targetPort: 8080 });
      const files = await readdir(directory);
      expect(files).toEqual(['lab-77777777777747778777777777777777.yml']);
      const route = await readFile(join(directory, files[0]!), 'utf8');
      expect(route).toContain(`rule: "PathPrefix(\`/labs/${routeKey}/\`)"`);
      expect(route).toContain(`prefixes: ["/labs/${routeKey}"]`);
      expect(route).toContain('servers: [{url: "http://cr-target:8080"}]');
      await router.remove(instanceId);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('proves the worker route directory is visible from ingress and removes the probe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cyber-range-traefik-'));
    try {
      const getArchive = vi.fn(async ({ path }: { path: string }) => {
        const marker = await readFile(join(directory, basename(path)));
        return Readable.from([Buffer.alloc(512), marker, Buffer.alloc(512)]);
      });
      const docker = { getContainer: vi.fn(() => ({ getArchive })) } as unknown as Docker;
      await new FileTraefikRouter(directory).verifyIngressVisibility(
        docker, 'traefik', '/etc/traefik/dynamic',
      );
      expect(docker.getContainer).toHaveBeenCalledWith('traefik');
      expect(getArchive).toHaveBeenCalledWith({
        path: expect.stringMatching(/^\/etc\/traefik\/dynamic\/\.cyber-range-preflight-[0-9a-f]{32}$/u),
      });
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when ingress cannot see the route directory and removes the probe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cyber-range-traefik-'));
    try {
      const docker = {
        getContainer: () => ({ getArchive: async () => { throw new Error('404'); } }),
      } as unknown as Docker;
      await expect(new FileTraefikRouter(directory).verifyIngressVisibility(
        docker, 'traefik', '/etc/traefik/dynamic',
      )).rejects.toThrow('Ingress cannot read the worker route directory');
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
