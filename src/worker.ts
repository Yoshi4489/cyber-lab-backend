import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import Docker from 'dockerode';
import { createDatabase } from './db/client.js';
import { DrizzleLifecycleJobRepository } from './db/lifecycle-job-repository.js';
import { DrizzleLifecycleStateRepository } from './db/lifecycle-state-repository.js';
import { DockerOrchestrator } from './orchestrator/docker-adapter.js';
import { loadRuntimeManifestRegistry } from './orchestrator/runtime-manifests.js';
import { FileTraefikRouter } from './orchestrator/traefik-router.js';
import { createRedisConnection, LifecycleQueue } from './queue/lifecycle-queue.js';
import { DockerLifecycleHandler } from './services/docker-lifecycle-handler.js';
import { HmacInstanceFlagService } from './services/instance-flags.js';
import { loadWorkerConfig, type WorkerConfig } from './worker-config.js';

const config = loadWorkerConfig();
const database = createDatabase(config.DATABASE_URL);
const jobRepository = new DrizzleLifecycleJobRepository(database.db);
const stateRepository = new DrizzleLifecycleStateRepository(database.db);
const manifests = await loadRuntimeManifestRegistry(config.RUNTIME_MANIFEST_PATH);
const docker = await createDockerClient(config);
const orchestrator = new DockerOrchestrator(
  docker,
  new FileTraefikRouter(config.TRAEFIK_DYNAMIC_DIRECTORY),
  config.LAB_INGRESS_CONTAINER,
);
const nodeId = await stateRepository.registerNode(config.LAB_NODE_NAME, new Date());
const handler = new DockerLifecycleHandler(
  stateRepository,
  manifests,
  new HmacInstanceFlagService(config.INSTANCE_FLAG_SECRET),
  orchestrator,
  nodeId,
);
const queue = new LifecycleQueue(createRedisConnection(config.REDIS_URL), jobRepository);
const worker = queue.createWorker(handler);
await worker.waitUntilReady();

let dispatching = false;
let maintaining = false;
async function dispatch(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    await queue.dispatchPending();
  } catch {
    reportWorkerError('dispatch');
  } finally {
    dispatching = false;
  }
}

async function maintain(): Promise<void> {
  if (maintaining) return;
  maintaining = true;
  try {
    await queue.scheduleMaintenance();
  } catch {
    reportWorkerError('maintenance');
  } finally {
    maintaining = false;
  }
}

await maintain();
const dispatchTimer = setInterval(() => void dispatch(), config.LIFECYCLE_DISPATCH_INTERVAL_MS);
const maintenanceTimer = setInterval(
  () => void maintain(),
  config.LIFECYCLE_MAINTENANCE_INTERVAL_MS,
);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(dispatchTimer);
  clearInterval(maintenanceTimer);
  await worker.close();
  await queue.close();
  await database.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
worker.on('error', () => reportWorkerError('worker'));

async function createDockerClient(workerConfig: WorkerConfig): Promise<Docker> {
  if (workerConfig.DOCKER_SOCKET_PATH) {
    return new Docker({ socketPath: workerConfig.DOCKER_SOCKET_PATH });
  }
  if (
    !workerConfig.DOCKER_HOST ||
    !workerConfig.DOCKER_CA_PATH ||
    !workerConfig.DOCKER_CERT_PATH ||
    !workerConfig.DOCKER_KEY_PATH
  ) {
    throw new Error('Remote Docker mTLS configuration is incomplete');
  }
  const endpoint = new URL(workerConfig.DOCKER_HOST);
  const [ca, cert, key] = await Promise.all([
    readFile(workerConfig.DOCKER_CA_PATH),
    readFile(workerConfig.DOCKER_CERT_PATH),
    readFile(workerConfig.DOCKER_KEY_PATH),
  ]);
  return new Docker({
    protocol: 'https',
    host: endpoint.hostname,
    port: Number(endpoint.port || 2376),
    ca,
    cert,
    key,
  });
}

function reportWorkerError(operation: string): void {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'lifecycle_worker_error', operation })}\n`);
}
