import { Readable } from 'node:stream';
import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { IngressTraefikRouter } from '../src/orchestrator/ingress-traefik-router.js';
import type { TraefikRoute } from '../src/orchestrator/traefik-router.js';

const instanceId = '77777777-7777-4777-8777-777777777777';
const routeKey = 'abcdefghijklmnopqrstuvwx12345678';
const directory = '/etc/traefik/dynamic';
const routePath = `${directory}/lab-77777777777747778777777777777777.yml`;

type RouteOverrides = {
  instanceId?: string;
  routeKey?: string;
  targetHost?: string;
  targetPort?: number;
};

function route(overrides: RouteOverrides = {}): TraefikRoute {
  return { instanceId, routeKey, targetHost: 'cr-target', targetPort: 8080, ...overrides };
}

describe('Traefik routes delivered into ingress', () => {
  it('delivers the rendered route into the ingress directory over the Docker channel', async () => {
    const ingress = ingressFixture();
    await new IngressTraefikRouter(ingress.docker, 'traefik', directory).upsert(route());

    expect(ingress.docker.getContainer).toHaveBeenCalledWith('traefik');
    expect(ingress.putArchive.mock.calls[0]?.[1]).toEqual({ path: directory });
    const delivered = ingress.files.get(routePath);
    expect(delivered).toContain(`rule: "PathPrefix(\`/labs/${routeKey}/\`)"`);
    expect(delivered).toContain(`prefixes: ["/labs/${routeKey}"]`);
    expect(delivered).toContain('servers: [{url: "http://cr-target:8080"}]');
  });

  it('builds a padded USTAR entry with a valid checksum', async () => {
    const ingress = ingressFixture();
    await new IngressTraefikRouter(ingress.docker, 'traefik', directory).upsert(route());

    const tar = ingress.putArchive.mock.calls[0]?.[0] as Buffer;
    expect(tar.length % 512).toBe(0);
    expect(tar.subarray(257, 262).toString('ascii')).toBe('ustar');
    expect(tar.subarray(156, 157).toString('ascii')).toBe('0');
    const stored = parseInt(tar.subarray(148, 156).toString('ascii').split('\0')[0]!.trim(), 8);
    const header = Buffer.from(tar.subarray(0, 512));
    header.write('        ', 148, 8, 'ascii');
    let expected = 0;
    for (const byte of header) expected += byte;
    expect(stored).toBe(expected);
  });

  it('removes a route with an argument vector rather than a shell, and is safe to retry', async () => {
    const ingress = ingressFixture();
    const router = new IngressTraefikRouter(ingress.docker, 'traefik', directory);
    await router.upsert(route());

    await router.remove(instanceId);
    expect(ingress.exec).toHaveBeenCalledWith(expect.objectContaining({
      Cmd: ['rm', '-f', '--', routePath],
      Privileged: false,
    }));
    expect(ingress.files.has(routePath)).toBe(false);
    await expect(router.remove(instanceId)).resolves.toBeUndefined();
  });

  it('rejects unvalidated route input exactly as the file router does', async () => {
    const router = new IngressTraefikRouter(ingressFixture().docker, 'traefik', directory);

    await expect(router.upsert(route({ instanceId: 'not-a-uuid' }))).rejects.toThrow('Invalid instance id');
    await expect(router.upsert(route({ routeKey: 'short' }))).rejects.toThrow('Invalid route key');
    await expect(router.upsert(route({ targetHost: '../evil' }))).rejects.toThrow('Invalid target host');
    await expect(router.upsert(route({ targetPort: 0 }))).rejects.toThrow('Invalid target port');
    await expect(router.remove('not-a-uuid')).rejects.toThrow('Invalid instance id');
  });

  it('refuses a traversing or relative ingress directory', () => {
    const { docker } = ingressFixture();
    expect(() => new IngressTraefikRouter(docker, 'traefik', 'etc/traefik')).toThrow(
      'Invalid ingress dynamic directory',
    );
    expect(() => new IngressTraefikRouter(docker, 'traefik', '/etc/../root')).toThrow(
      'Invalid ingress dynamic directory',
    );
  });

  it('fails a removal that reports a non-zero exit code', async () => {
    const ingress = ingressFixture({ exitCode: 1 });
    const router = new IngressTraefikRouter(ingress.docker, 'traefik', directory);

    await expect(router.remove(instanceId)).rejects.toThrow('Ingress route removal exited with 1');
  });
});

describe('ingress delivery verification', () => {
  it('writes, reads back, deletes a marker and leaves nothing behind', async () => {
    const ingress = ingressFixture();
    await expect(
      new IngressTraefikRouter(ingress.docker, 'traefik', directory).verifyDelivery(),
    ).resolves.toBeUndefined();
    expect(ingress.files.size).toBe(0);
    expect(ingress.putArchive).toHaveBeenCalledOnce();
  });

  it('fails closed when the delivered marker cannot be read back', async () => {
    const ingress = ingressFixture({ readable: false });
    await expect(
      new IngressTraefikRouter(ingress.docker, 'traefik', directory).verifyDelivery(),
    ).rejects.toThrow('Cannot deliver Traefik routes to ingress');
  });

  it('fails closed when removal silently leaves the marker in place', async () => {
    const ingress = ingressFixture({ removes: false });
    await expect(
      new IngressTraefikRouter(ingress.docker, 'traefik', directory).verifyDelivery(),
    ).rejects.toThrow('deleted marker is still present in ingress');
  });
});

function ingressFixture(options: { exitCode?: number; readable?: boolean; removes?: boolean } = {}) {
  const files = new Map<string, string>();
  const putArchive = vi.fn(async (tar: Buffer, { path }: { path: string }) => {
    const name = tar.subarray(0, 100).toString('utf8').split('\0')[0]!;
    const size = parseInt(tar.subarray(124, 136).toString('ascii').split('\0')[0]!.trim(), 8);
    files.set(`${path}/${name}`, tar.subarray(512, 512 + size).toString('utf8'));
    return Readable.from([]) as unknown as NodeJS.ReadWriteStream;
  });
  const getArchive = vi.fn(async ({ path }: { path: string }) => {
    const contents = options.readable === false ? undefined : files.get(path);
    if (contents === undefined) throw Object.assign(new Error('no such file'), { statusCode: 404 });
    return Readable.from([Buffer.alloc(512), Buffer.from(contents, 'utf8')]);
  });
  const exec = vi.fn(async ({ Cmd }: { Cmd?: string[] }) => {
    const target = Cmd?.[3];
    return {
      start: async () => {
        if (options.removes !== false && target) files.delete(target);
        return Readable.from([]);
      },
      inspect: async () => ({ ExitCode: options.exitCode ?? 0 }),
    };
  });
  const docker = {
    getContainer: vi.fn(() => ({ putArchive, getArchive, exec })),
  } as unknown as Docker;
  return { docker, files, putArchive, getArchive, exec };
}
