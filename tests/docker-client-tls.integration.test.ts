import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { afterAll, describe, expect, it } from 'vitest';
import { createWorkerDockerClient } from '../src/orchestrator/docker-client.js';
import { loadWorkerConfig } from '../src/worker-config.js';

const opensslAvailable = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;
const describeTls = opensslAvailable ? describe : describe.skip;

describeTls('remote Docker mTLS', () => {
  let directory: string;

  afterAll(async () => {
    if (!directory) return;
    const temporaryRoot = resolve(tmpdir()) + sep;
    if (!resolve(directory).startsWith(temporaryRoot)) throw new Error('Unsafe TLS fixture path');
    await rm(directory, { recursive: true, force: true });
  });

  it('accepts the trusted server and client, then rejects an untrusted server CA', async () => {
    directory = await mkdtemp(join(tmpdir(), 'cyber-range-mtls-'));
    await generateCertificate('ca', '/CN=Phase4TestCA', true);
    await generateCertificate('other-ca', '/CN=Phase4OtherCA', true);
    await generateCertificate('server', '/CN=127.0.0.1', false,
      'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
    await generateCertificate('client', '/CN=Phase4TestClient', false,
      'extendedKeyUsage=clientAuth\n');

    let authorizedRequests = 0;
    const server = createServer({
      key: await readFile(join(directory, 'server.key')),
      cert: await readFile(join(directory, 'server.crt')),
      ca: await readFile(join(directory, 'ca.crt')),
      requestCert: true,
      rejectUnauthorized: true,
    }, (request, response) => {
      if ((request.socket as TLSSocket).authorized) authorizedRequests += 1;
      response.writeHead(request.url === '/_ping' ? 200 : 404);
      response.end(request.url === '/_ping' ? 'OK' : 'not found');
    });
    try {
      await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('TLS fixture has no port');
      const paths = {
        DOCKER_CA_PATH: join(directory, 'ca.crt'),
        DOCKER_CERT_PATH: join(directory, 'client.crt'),
        DOCKER_KEY_PATH: join(directory, 'client.key'),
      };
      const base = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://example.test/range',
        REDIS_URL: 'redis://example.test:6379',
        INSTANCE_FLAG_SECRET: 'worker-flag-secret-at-least-thirty-two-characters',
        RUNTIME_MANIFEST_PATH: '/run/config/manifests.json',
        TRAEFIK_DYNAMIC_DIRECTORY: '/run/traefik/dynamic',
        LAB_INGRESS_CONTAINER: 'traefik',
        DOCKER_HOST: `https://127.0.0.1:${address.port}`,
      };
      const docker = await createWorkerDockerClient(loadWorkerConfig({ ...base, ...paths }));
      await expect(docker.ping()).resolves.toBeDefined();
      expect(authorizedRequests).toBe(1);

      const untrusted = await createWorkerDockerClient(loadWorkerConfig({
        ...base,
        ...paths,
        DOCKER_CA_PATH: join(directory, 'other-ca.crt'),
      }));
      await expect(untrusted.ping()).rejects.toThrow();
      expect(authorizedRequests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => {
        if (error) rejectClose(error);
        else resolveClose();
      }));
    }
  }, 30_000);

  async function generateCertificate(
    name: string,
    subject: string,
    certificateAuthority: boolean,
    extensions?: string,
  ): Promise<void> {
    if (certificateAuthority) {
      openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', `${name}.key`, '-out', `${name}.crt`, '-days', '1', '-subj', subject);
      return;
    }
    openssl('req', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', subject);
    if (extensions) await writeFile(join(directory, `${name}.ext`), extensions);
    openssl('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key',
      '-CAcreateserial', '-out', `${name}.crt`, '-days', '1', '-extfile', `${name}.ext`);
  }

  function openssl(...args: string[]): void {
    execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });
  }
});
