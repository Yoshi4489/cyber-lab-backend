import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

export class FileTraefikRouter implements TraefikRouter {
  constructor(private readonly directory: string) {}

  async upsert(route: TraefikRoute): Promise<void> {
    validateRoute(route);
    await mkdir(this.directory, { recursive: true });
    const name = resourceName(route.instanceId);
    const path = this.pathFor(route.instanceId);
    const temporaryPath = `${path}.${process.pid}.tmp`;
    const configuration = {
      http: {
        routers: {
          [name]: {
            rule: `PathPrefix(\`/labs/${route.routeKey}/\`)`,
            entryPoints: ['websecure'],
            middlewares: [`${name}-strip`],
            service: name,
            tls: {},
          },
        },
        middlewares: {
          [`${name}-strip`]: {
            stripPrefix: { prefixes: [`/labs/${route.routeKey}`] },
          },
        },
        services: {
          [name]: {
            loadBalancer: {
              servers: [{ url: `http://${route.targetHost}:${route.targetPort}` }],
            },
          },
        },
      },
    };
    await writeFile(temporaryPath, `${JSON.stringify(configuration, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  }

  async remove(instanceId: string): Promise<void> {
    if (!uuid.test(instanceId)) throw new Error('Invalid instance id');
    await unlink(this.pathFor(instanceId)).catch((error: unknown) => {
      if (!isFileNotFound(error)) throw error;
    });
  }

  private pathFor(instanceId: string): string {
    return join(this.directory, `${resourceName(instanceId)}.json`);
  }
}

function validateRoute(route: TraefikRoute): void {
  if (!uuid.test(route.instanceId)) throw new Error('Invalid instance id');
  if (!safeRouteKey.test(route.routeKey)) throw new Error('Invalid route key');
  if (!safeName.test(route.targetHost)) throw new Error('Invalid target host');
  if (!Number.isInteger(route.targetPort) || route.targetPort < 1 || route.targetPort > 65_535) {
    throw new Error('Invalid target port');
  }
}

function resourceName(instanceId: string): string {
  return `lab-${instanceId.replaceAll('-', '')}`;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
