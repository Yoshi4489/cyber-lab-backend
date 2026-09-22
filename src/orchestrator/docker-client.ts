import { readFile } from 'node:fs/promises';
import Docker from 'dockerode';
import type { WorkerConfig } from '../worker-config.js';

export async function createWorkerDockerClient(config: WorkerConfig): Promise<Docker> {
  if (config.DOCKER_SOCKET_PATH) {
    return new Docker({ socketPath: config.DOCKER_SOCKET_PATH });
  }
  if (
    !config.DOCKER_HOST ||
    !config.DOCKER_CA_PATH ||
    !config.DOCKER_CERT_PATH ||
    !config.DOCKER_KEY_PATH
  ) {
    throw new Error('Remote Docker mTLS configuration is incomplete');
  }
  const endpoint = new URL(config.DOCKER_HOST);
  const [ca, cert, key] = await Promise.all([
    readFile(config.DOCKER_CA_PATH),
    readFile(config.DOCKER_CERT_PATH),
    readFile(config.DOCKER_KEY_PATH),
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
