import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/worker-config.js';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://example.test/range',
  REDIS_URL: 'redis://example.test:6379',
  INSTANCE_FLAG_SECRET: 'worker-flag-secret-at-least-thirty-two-characters',
  RUNTIME_MANIFEST_PATH: '/run/config/manifests.json',
  TRAEFIK_ROUTE_DELIVERY: 'ingress',
  TRAEFIK_CONTAINER_DYNAMIC_DIRECTORY: '/etc/traefik/dynamic',
  LAB_INGRESS_CONTAINER: 'traefik',
};

describe('worker configuration boundary', () => {
  it('rejects the Docker tooling certificate variable with migration guidance', () => {
    expect(() => loadWorkerConfig({
      ...base,
      DOCKER_HOST: 'https://lab.example.test:2376',
      DOCKER_CA_PATH: '/run/secrets/docker-ca.pem',
      DOCKER_CERT_PATH: '/run/secrets/docker-cert.pem',
      DOCKER_KEY_PATH: '/run/secrets/docker-key.pem',
    })).toThrow('use DOCKER_CLIENT_CERT_PATH for the worker certificate file');
  });

  it('requires ingress route delivery in production', () => {
    const { TRAEFIK_ROUTE_DELIVERY: _mode, ...withoutMode } = base;
    expect(() => loadWorkerConfig(withoutMode)).toThrow(
      'Production workers must deliver routes into the ingress container',
    );
    expect(() => loadWorkerConfig({
      ...base,
      TRAEFIK_ROUTE_DELIVERY: 'file',
      TRAEFIK_DYNAMIC_DIRECTORY: '/run/traefik/dynamic',
    })).toThrow('Production workers must deliver routes into the ingress container');
  });

  it('requires the directory each delivery mode actually writes to', () => {
    const { TRAEFIK_CONTAINER_DYNAMIC_DIRECTORY: _directory, ...withoutIngress } = base;
    expect(() => loadWorkerConfig(withoutIngress)).toThrow(
      'Ingress route delivery requires the ingress route directory',
    );
    expect(() => loadWorkerConfig({
      ...withoutIngress,
      NODE_ENV: 'development',
      TRAEFIK_ROUTE_DELIVERY: 'file',
      DOCKER_SOCKET_PATH: '/var/run/docker.sock',
    })).toThrow('File route delivery requires a worker route directory');
  });

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
      DOCKER_CLIENT_CERT_PATH: '/run/secrets/docker-cert.pem',
      DOCKER_KEY_PATH: '/run/secrets/docker-key.pem',
    })).toMatchObject({
      LAB_NODE_NAME: 'local-lab-node',
      DOCKER_HOST: 'https://lab.example.test:2376',
    });
  });

  it('rejects Docker endpoint credentials and paths before reading TLS material', () => {
    const tls = {
      ...base,
      DOCKER_CA_PATH: '/run/secrets/docker-ca.pem',
      DOCKER_CLIENT_CERT_PATH: '/run/secrets/docker-cert.pem',
      DOCKER_KEY_PATH: '/run/secrets/docker-key.pem',
    };
    for (const DOCKER_HOST of [
      'https://user:password@lab.example.test:2376',
      'https://lab.example.test:2376/containers',
      'https://lab.example.test:2376/?token=secret',
      'http://lab.example.test:2375',
    ]) {
      expect(() => loadWorkerConfig({ ...tls, DOCKER_HOST })).toThrow(
        'Docker endpoint must be an HTTPS host',
      );
    }
  });
});
