import 'dotenv/config';
import { createWorkerDockerClient } from './orchestrator/docker-client.js';
import { DockerOrchestrator } from './orchestrator/docker-adapter.js';
import { loadRuntimeManifestRegistry } from './orchestrator/runtime-manifests.js';
import { FileTraefikRouter } from './orchestrator/traefik-router.js';
import { loadWorkerConfig } from './worker-config.js';

const config = loadWorkerConfig();
const manifests = await loadRuntimeManifestRegistry(config.RUNTIME_MANIFEST_PATH);
const docker = await createWorkerDockerClient(config);
const orchestrator = new DockerOrchestrator(
  docker,
  new FileTraefikRouter(config.TRAEFIK_DYNAMIC_DIRECTORY),
  config.LAB_INGRESS_CONTAINER,
);

await orchestrator.preflight(manifests.all());
process.stdout.write(`${JSON.stringify({ status: 'ready', manifestCount: manifests.all().length })}\n`);
