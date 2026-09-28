import type Docker from 'dockerode';
import { IngressTraefikRouter } from './ingress-traefik-router.js';
import { FileTraefikRouter, type TraefikRouter } from './traefik-router.js';
import type { WorkerConfig } from '../worker-config.js';

export type RouteDelivery = {
  router: TraefikRouter;
  /**
   * Checked once at worker and preflight startup. It must fail closed: a worker
   * whose routes cannot reach ingress would start targets players can never use.
   */
  verify(): Promise<void>;
};

/**
 * Chooses how Traefik routes reach the ingress. `file` writes beside the worker
 * and suits a single disposable host; `ingress` delivers over the worker's
 * authenticated Docker connection and is required once ingress runs on a
 * separate target host.
 */
export function createRouteDelivery(docker: Docker, config: WorkerConfig): RouteDelivery {
  const containerDirectory = config.TRAEFIK_CONTAINER_DYNAMIC_DIRECTORY;
  if (config.TRAEFIK_ROUTE_DELIVERY === 'ingress') {
    if (!containerDirectory) {
      throw new Error('Ingress route delivery requires the ingress route directory');
    }
    const router = new IngressTraefikRouter(docker, config.LAB_INGRESS_CONTAINER, containerDirectory);
    return { router, verify: () => router.verifyDelivery() };
  }
  if (!config.TRAEFIK_DYNAMIC_DIRECTORY) {
    throw new Error('File route delivery requires a worker route directory');
  }
  const router = new FileTraefikRouter(config.TRAEFIK_DYNAMIC_DIRECTORY);
  return {
    router,
    verify: containerDirectory
      ? () => router.verifyIngressVisibility(docker, config.LAB_INGRESS_CONTAINER, containerDirectory)
      : () => Promise.resolve(),
  };
}
