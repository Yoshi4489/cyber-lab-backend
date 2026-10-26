import 'dotenv/config';
import { createDatabase } from './db/client.js';
import { DrizzleLifecycleJobRepository } from './db/lifecycle-job-repository.js';
import { DrizzleLifecycleStateRepository } from './db/lifecycle-state-repository.js';
import { DrizzleManagedCleanupRepository } from './db/managed-cleanup-repository.js';
import { createWorkerDockerClient } from './orchestrator/docker-client.js';
import { DockerOrchestrator } from './orchestrator/docker-adapter.js';
import { loadRuntimeManifestRegistry } from './orchestrator/runtime-manifests.js';
import { createRouteDelivery } from './orchestrator/route-delivery.js';
import { createRedisConnection, LifecycleQueue } from './queue/lifecycle-queue.js';
import { DockerLifecycleHandler } from './services/docker-lifecycle-handler.js';
import { ManagedResourceSweeper } from './services/managed-resource-cleanup.js';
import { SerializedLifecycleRunner } from './services/serialized-lifecycle-runner.js';
import { createRuntimeFlagDeriver } from './services/runtime-flags.js';
import { loadWorkerConfig } from './worker-config.js';

const config = loadWorkerConfig();
const database = createDatabase(config.DATABASE_URL);
const jobRepository = new DrizzleLifecycleJobRepository(database.db);
const stateRepository = new DrizzleLifecycleStateRepository(database.db);
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
await orchestrator.inventoryManagedResources();
const nodeId = await stateRepository.registerNode(config.LAB_NODE_NAME, config.LAB_NODE_CAPACITY_SLOTS, new Date());
const handler = new DockerLifecycleHandler(
  stateRepository,
  manifests,
  createRuntimeFlagDeriver(config.INSTANCE_FLAG_SECRET, config),
  orchestrator,
  nodeId,
);
const queue = new LifecycleQueue(createRedisConnection(config.REDIS_URL), jobRepository);
const runner = new SerializedLifecycleRunner(handler,
  new ManagedResourceSweeper(new DrizzleManagedCleanupRepository(database.db), orchestrator, nodeId));
const worker = queue.createWorker(runner);

let dispatching = false;
let maintaining = false;
let closing = false;
let dispatchTimer: ReturnType<typeof setInterval> | undefined;
let maintenanceTimer: ReturnType<typeof setInterval> | undefined;
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
  if (maintaining || closing) return;
  maintaining = true;
  try {
    await runner.sweep();
    if (!closing) await queue.scheduleMaintenance();
  } catch {
    reportWorkerError('maintenance');
  } finally {
    maintaining = false;
  }
}

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  if (dispatchTimer) clearInterval(dispatchTimer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  await worker.close();
  await runner.drain();
  await queue.close();
  await database.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
worker.on('error', () => reportWorkerError('worker'));

await worker.waitUntilReady();
if (!closing) {
  await maintain();
  if (!closing) {
    dispatchTimer = setInterval(() => void dispatch(), config.LIFECYCLE_DISPATCH_INTERVAL_MS);
    maintenanceTimer = setInterval(() => void maintain(), config.LIFECYCLE_MAINTENANCE_INTERVAL_MS);
  }
}

function reportWorkerError(operation: string): void {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'lifecycle_worker_error', operation })}\n`);
}
