import 'dotenv/config';
import { createWorkerDockerClient } from './orchestrator/docker-client.js';
import { DockerOrchestrator } from './orchestrator/docker-adapter.js';
import { loadRuntimeManifestRegistry } from './orchestrator/runtime-manifests.js';
import { FileTraefikRouter } from './orchestrator/traefik-router.js';
import { loadWorkerConfig } from './worker-config.js';

const config = loadWorkerConfig();
const manifests = await loadRuntimeManifestRegistry(config.RUNTIME_MANIFEST_PATH);
const docker = await createWorkerDockerClient(config);
const router = new FileTraefikRouter(config.TRAEFIK_DYNAMIC_DIRECTORY);
const orchestrator = new DockerOrchestrator(
  docker,
  router,
  config.LAB_INGRESS_CONTAINER,
);

await orchestrator.preflight(manifests.all());
if (config.TRAEFIK_CONTAINER_DYNAMIC_DIRECTORY) {
  await router.verifyIngressVisibility(
    docker, config.LAB_INGRESS_CONTAINER, config.TRAEFIK_CONTAINER_DYNAMIC_DIRECTORY,
  );
}
process.stdout.write(`${JSON.stringify({ status: 'ready', manifestCount: manifests.all().length })}\n`);
