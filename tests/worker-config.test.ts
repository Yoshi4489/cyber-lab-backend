import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/worker-config.js';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://example.test/range',
  REDIS_URL: 'redis://example.test:6379',
  INSTANCE_FLAG_SECRET: 'worker-flag-secret-at-least-thirty-two-characters',
  RUNTIME_MANIFEST_PATH: '/run/config/manifests.json',
  TRAEFIK_DYNAMIC_DIRECTORY: '/run/traefik/dynamic',
  LAB_INGRESS_CONTAINER: 'traefik',
};

describe('worker configuration boundary', () => {
  it('requires complete remote Docker mTLS in production', () => {
    expect(() => loadWorkerConfig({ ...base, DOCKER_SOCKET_PATH: '/var/run/docker.sock' })).toThrow(
      'Production workers require remote Docker mTLS',
    );
    expect(() => loadWorkerConfig({ ...base, DOCKER_HOST: 'https://lab.example.test:2376' }))
      .toThrow('Remote Docker requires host, CA, cert, and key');
  });

  it('accepts a complete remote mTLS configuration without exposing it to API config', () => {
    expect(loadWorkerConfig({
      ...base,
      DOCKER_HOST: 'https://lab.example.test:2376',
      DOCKER_CA_PATH: '/run/secrets/docker-ca.pem',
      DOCKER_CERT_PATH: '/run/secrets/docker-cert.pem',
      DOCKER_KEY_PATH: '/run/secrets/docker-key.pem',
    })).toMatchObject({
      LAB_NODE_NAME: 'local-lab-node',
      DOCKER_HOST: 'https://lab.example.test:2376',
    });
  });
});
