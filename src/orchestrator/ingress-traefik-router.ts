import { randomBytes } from 'node:crypto';
import type Docker from 'dockerode';
import {
  assertContainerDirectory,
  assertInstanceId,
  readArchive,
  renderRouteDocument,
  routeFileName,
  validateRoute,
  type TraefikRoute,
  type TraefikRouter,
} from './traefik-router.js';

/**
 * Delivers Traefik file-provider routes into the ingress container over the
 * worker's existing authenticated Docker connection.
 *
 * Production runs the worker and the ingress on separate hosts, so writing a
 * route beside the worker leaves it on the wrong machine. This router reuses the
 * mTLS Docker channel that the worker must already hold: delivery is one-way
 * control-plane to target, and the target host gains no control-plane
 * credential and no inbound management route.
 */
export class IngressTraefikRouter implements TraefikRouter {
  constructor(
    private readonly docker: Docker,
    private readonly ingressContainer: string,
    private readonly containerDirectory: string,
  ) {
    assertContainerDirectory(containerDirectory);
  }

  async upsert(route: TraefikRoute): Promise<void> {
    validateRoute(route);
    await this.write(routeFileName(route.instanceId), renderRouteDocument(route));
  }

  async remove(instanceId: string): Promise<void> {
    assertInstanceId(instanceId);
    await this.delete(routeFileName(instanceId));
  }

  /**
   * Proves the whole delivery path before the worker accepts lifecycle jobs:
   * a random marker is written into ingress, read back, deleted, and confirmed
   * gone. Any failure is fatal, so a misconfigured ingress cannot silently
   * accept targets whose routes never arrive.
   */
  async verifyDelivery(): Promise<void> {
    const name = `.cyber-range-delivery-${randomBytes(16).toString('hex')}`;
    const marker = randomBytes(32).toString('hex');
    try {
      await this.write(name, marker);
      if (!(await this.read(name)).includes(marker)) {
        throw new Error('delivered marker was not readable in ingress');
      }
      await this.delete(name);
      let removed = false;
      try {
        removed = !(await this.read(name)).includes(marker);
      } catch {
        removed = true;
      }
      if (!removed) throw new Error('deleted marker is still present in ingress');
    } catch (error) {
      await this.delete(name).catch(() => undefined);
      throw new Error(
        `Cannot deliver Traefik routes to ingress: ${error instanceof Error ? error.message : 'unknown failure'}`,
        { cause: error },
      );
    }
  }

  private async write(name: string, contents: string): Promise<void> {
    await this.docker.getContainer(this.ingressContainer).putArchive(
      tarSingleFile(name, contents),
      { path: this.containerDirectory },
    );
  }

  private async read(name: string): Promise<string> {
    return readArchive(await this.docker.getContainer(this.ingressContainer).getArchive({
      path: `${this.containerDirectory}/${name}`,
    }));
  }

  /**
   * The Docker API can extract files into a container but cannot delete one, so
   * removal runs `rm` as an argument vector. No shell is involved and the path
   * is built only from a validated instance id and the configured directory.
   */
  private async delete(name: string): Promise<void> {
    const exec = await this.docker.getContainer(this.ingressContainer).exec({
      Cmd: ['rm', '-f', '--', `${this.containerDirectory}/${name}`],
      AttachStdout: true,
      AttachStderr: true,
      Privileged: false,
      Tty: false,
    });
    const stream = await exec.start({ Detach: false, Tty: false });
    await new Promise<void>((resolve, reject) => {
      stream.on('data', () => undefined);
      stream.once('end', resolve);
      stream.once('close', resolve);
      stream.once('error', reject);
    });
    const { ExitCode } = await exec.inspect();
    if (ExitCode !== 0) {
      throw new Error(`Ingress route removal exited with ${ExitCode ?? 'no status'}`);
    }
  }
}

const TAR_BLOCK = 512;

/**
 * Minimal single-entry USTAR archive. Docker's extract endpoint takes a tar, and
 * one hand-written 512-byte header keeps the delivery path auditable without
 * adding an archive dependency to the control plane.
 */
function tarSingleFile(name: string, contents: string): Buffer {
  const encodedName = Buffer.from(name, 'utf8');
  if (encodedName.length === 0 || encodedName.length > 100) {
    throw new Error('Invalid ingress route file name');
  }
  const body = Buffer.from(contents, 'utf8');
  const header = Buffer.alloc(TAR_BLOCK);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(octal(body.length, 11), 124, 12, 'ascii');
  header.write(octal(Math.floor(Date.now() / 1_000), 11), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc((TAR_BLOCK - (body.length % TAR_BLOCK)) % TAR_BLOCK);
  return Buffer.concat([header, body, padding, Buffer.alloc(TAR_BLOCK * 2)]);
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width, '0')}\0`;
}
