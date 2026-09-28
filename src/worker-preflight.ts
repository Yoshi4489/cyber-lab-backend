import 'dotenv/config';
import { createWorkerDockerClient } from './orchestrator/docker-client.js';
import { DockerOrchestrator } from './orchestrator/docker-adapter.js';
import { createRouteDelivery } from './orchestrator/route-delivery.js';
import { loadRuntimeManifestRegistry } from './orchestrator/runtime-manifests.js';
import { loadWorkerConfig } from './worker-config.js';

const config = loadWorkerConfig();
const manifests = await loadRuntimeManifestRegistry(config.RUNTIME_MANIFEST_PATH);
const docker = await createWorkerDockerClient(config);
const delivery = createRouteDelivery(docker, config);
const orchestrator = new DockerOrchestrator(
  docker,
  delivery.router,
  config.LAB_INGRESS_CONTAINER,
);

await orchestrator.preflight(manifests.all());
await delivery.verify();
process.stdout.write(`${JSON.stringify({
  status: 'ready',
  manifestCount: manifests.all().length,
  routeDelivery: config.TRAEFIK_ROUTE_DELIVERY,
})}\n`);
