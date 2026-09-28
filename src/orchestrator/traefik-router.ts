import { randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Docker from 'dockerode';

export type TraefikRoute = {
  instanceId: string;
  routeKey: string;
  targetHost: string;
  targetPort: number;
};

export type TraefikRouter = {
  upsert(route: TraefikRoute): Promise<void>;
  remove(instanceId: string): Promise<void>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const safeName = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const safeRouteKey = /^[A-Za-z0-9_-]{24,64}$/u;
const absoluteDirectory = /^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/u;

export class FileTraefikRouter implements TraefikRouter {
  constructor(private readonly directory: string) {}

  async verifyIngressVisibility(docker: Docker, ingressContainer: string, containerDirectory: string): Promise<void> {
    assertContainerDirectory(containerDirectory);
    const markerName = `.cyber-range-preflight-${randomBytes(16).toString('hex')}`;
    const marker = randomBytes(32).toString('hex');
    await mkdir(this.directory, { recursive: true });
    const markerPath = join(this.directory, markerName);
    try {
      await writeFile(markerPath, marker, { encoding: 'utf8', mode: 0o644, flag: 'wx' });
      const archive = await docker.getContainer(ingressContainer).getArchive({
        path: `${containerDirectory}/${markerName}`,
      });
      if (!(await readArchive(archive)).includes(marker)) {
        throw new Error('Ingress cannot read the worker route directory');
      }
    } catch {
      throw new Error('Ingress cannot read the worker route directory');
    } finally {
      await unlink(markerPath).catch((error: unknown) => {
        if (!isFileNotFound(error)) throw error;
      });
    }
  }

  async upsert(route: TraefikRoute): Promise<void> {
    validateRoute(route);
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, routeFileName(route.instanceId));
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, renderRouteDocument(route), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  }

  async remove(instanceId: string): Promise<void> {
    assertInstanceId(instanceId);
    await unlink(join(this.directory, routeFileName(instanceId))).catch((error: unknown) => {
      if (!isFileNotFound(error)) throw error;
    });
  }
}

/**
 * Renders the Traefik file-provider document for one instance. Both the local
 * and the ingress-delivered routers use this so a remote route is byte-identical
 * to the validated local one.
 */
export function renderRouteDocument(route: TraefikRoute): string {
  const name = resourceName(route.instanceId);
  return [
    'http:',
    '  routers:',
    `    ${name}:`,
    `      rule: ${JSON.stringify(`PathPrefix(\`/labs/${route.routeKey}/\`)`)}`,
    '      entryPoints: [websecure]',
    `      middlewares: [${name}-strip]`,
    `      service: ${name}`,
    '      tls: {}',
    '  middlewares:',
    `    ${name}-strip:`,
    '      stripPrefix:',
    `        prefixes: [${JSON.stringify(`/labs/${route.routeKey}`)}]`,
    '  services:',
    `    ${name}:`,
    '      loadBalancer:',
    `        servers: [{url: ${JSON.stringify(`http://${route.targetHost}:${route.targetPort}`)}}]`,
    '',
  ].join('\n');
}

export function validateRoute(route: TraefikRoute): void {
  assertInstanceId(route.instanceId);
  if (!safeRouteKey.test(route.routeKey)) throw new Error('Invalid route key');
  if (!safeName.test(route.targetHost)) throw new Error('Invalid target host');
  if (!Number.isInteger(route.targetPort) || route.targetPort < 1 || route.targetPort > 65_535) {
    throw new Error('Invalid target port');
  }
}

export function assertInstanceId(instanceId: string): void {
  if (!uuid.test(instanceId)) throw new Error('Invalid instance id');
}

/** Rejects relative paths and traversal before any path reaches the Docker API. */
export function assertContainerDirectory(directory: string): void {
  if (!absoluteDirectory.test(directory) || directory.split('/').includes('..')) {
    throw new Error('Invalid ingress dynamic directory');
  }
}

export function routeFileName(instanceId: string): string {
  return `${resourceName(instanceId)}.yml`;
}

export async function readArchive(
  archive: AsyncIterable<Buffer | string | Uint8Array>,
  limit = 16_384,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of archive) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new Error('Ingress archive response is too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('binary');
}

function resourceName(instanceId: string): string {
  return `lab-${instanceId.replaceAll('-', '')}`;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
