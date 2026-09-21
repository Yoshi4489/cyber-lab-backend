import type Docker from 'dockerode';
import type { RuntimeManifest } from './runtime-manifests.js';
import type { TraefikRouter } from './traefik-router.js';

const MANAGED_LABEL = 'cyber-range.managed';
const INSTANCE_LABEL = 'cyber-range.instance-id';
const CHALLENGE_LABEL = 'cyber-range.challenge-id';

export type SpawnTargetInput = {
  instanceId: string;
  challengeId: string;
  routeKey: string;
  flag: string;
  manifest: RuntimeManifest;
};

export type SpawnedTarget = {
  containerId: string;
  networkId: string;
};

export type DestroyTargetInput = {
  instanceId: string;
  containerId: string | null;
  networkId: string | null;
};

export class DockerOrchestrator {
  private hostVerified = false;

  constructor(
    private readonly docker: Docker,
    private readonly router: TraefikRouter,
    private readonly ingressContainer?: string,
  ) {}

  async spawn(input: SpawnTargetInput): Promise<SpawnedTarget> {
    validateSpawnInput(input);
    await this.verifyHostSecurity();
    const names = resourceNames(input.instanceId);
    const existing = await this.findContainer(input.instanceId);
    if (existing) {
      const network = await this.findNetwork(input.instanceId);
      if (!network) throw new Error('Managed container is missing its isolated network');
      try {
        await startContainer(existing.container);
        await this.router.upsert({
          instanceId: input.instanceId,
          routeKey: input.routeKey,
          targetHost: names.container,
          targetPort: input.manifest.containerPort,
        });
        await this.waitUntilHealthy(existing, input.manifest.healthcheck.startupSeconds);
        return { containerId: existing.id, networkId: network.id };
      } catch (error) {
        await this.router.remove(input.instanceId).catch(() => undefined);
        await removeContainer(existing.container).catch(() => undefined);
        await removeNetwork(network.network).catch(() => undefined);
        throw error;
      }
    }

    let network: Docker.Network | undefined;
    let container: Docker.Container | undefined;
    try {
      network = await this.docker.createNetwork({
        Name: names.network,
        Internal: true,
        Attachable: false,
        CheckDuplicate: true,
        Labels: managedLabels(input.instanceId, input.challengeId),
      });
      if (this.ingressContainer) {
        await network.connect({ Container: this.ingressContainer });
      }
      container = await this.docker.createContainer(
        buildContainerOptions(input, names.container, names.network),
      );
      await startContainer(container);
      await this.router.upsert({
        instanceId: input.instanceId,
        routeKey: input.routeKey,
        targetHost: names.container,
        targetPort: input.manifest.containerPort,
      });
      await this.waitUntilHealthy(
        { id: container.id, container },
        input.manifest.healthcheck.startupSeconds,
      );
      return { containerId: container.id, networkId: network.id };
    } catch (error) {
      await this.router.remove(input.instanceId).catch(() => undefined);
      await removeContainer(container).catch(() => undefined);
      await removeNetwork(network).catch(() => undefined);
      throw error;
    }
  }

  async destroy(input: DestroyTargetInput): Promise<void> {
    await this.router.remove(input.instanceId);
    const container = input.containerId
      ? await this.getManagedContainer(input.containerId, input.instanceId)
      : (await this.findContainer(input.instanceId))?.container;
    if (container) await removeContainer(container);
    const network = input.networkId
      ? await this.getManagedNetwork(input.networkId, input.instanceId)
      : (await this.findNetwork(input.instanceId))?.network;
    if (network) await removeNetwork(network);
  }

  async hasManagedContainer(instanceId: string): Promise<boolean> {
    return (await this.findContainer(instanceId)) !== null;
  }

  private async verifyHostSecurity(): Promise<void> {
    if (this.hostVerified) return;
    const info = await this.docker.info();
    const rawOptions: unknown = info.SecurityOptions;
    const options = Array.isArray(rawOptions)
      ? rawOptions.filter((option): option is string => typeof option === 'string')
          .map((option) => option.toLowerCase())
      : [];
    for (const required of ['userns', 'seccomp', 'apparmor']) {
      if (!options.some((option) => option.includes(required))) {
        throw new Error(`Docker host is missing required ${required} isolation`);
      }
    }
    this.hostVerified = true;
  }

  private async findContainer(instanceId: string) {
    const containers = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [`${MANAGED_LABEL}=true`, `${INSTANCE_LABEL}=${instanceId}`] }),
    });
    const match = containers[0];
    if (!match) return null;
    return { id: match.Id, container: this.docker.getContainer(match.Id) };
  }

  private async findNetwork(instanceId: string) {
    const networks = await this.docker.listNetworks({
      filters: JSON.stringify({ label: [`${MANAGED_LABEL}=true`, `${INSTANCE_LABEL}=${instanceId}`] }),
    });
    const match = networks[0];
    if (!match?.Id) return null;
    return { id: match.Id, network: this.docker.getNetwork(match.Id) };
  }

  private async getManagedContainer(containerId: string, instanceId: string) {
    const container = this.docker.getContainer(containerId);
    const details = await container.inspect().catch((error: unknown) => {
      if (isDockerNotFound(error)) return null;
      throw error;
    });
    if (!details) return undefined;
    assertManagedLabels(details.Config?.Labels, instanceId);
    return container;
  }

  private async getManagedNetwork(networkId: string, instanceId: string) {
    const network = this.docker.getNetwork(networkId);
    const details = await network.inspect().catch((error: unknown) => {
      if (isDockerNotFound(error)) return null;
      throw error;
    });
    if (!details) return undefined;
    assertManagedLabels(details.Labels, instanceId);
    return network;
  }

  private async waitUntilHealthy(
    target: { id: string; container: Docker.Container },
    startupSeconds: number,
  ): Promise<void> {
    const deadline = Date.now() + startupSeconds * 1_000;
    while (Date.now() < deadline) {
      const details = await target.container.inspect();
      if (!details.State.Running) throw new Error('Target stopped before becoming healthy');
      if (details.State.Health?.Status === 'healthy') return;
      if (details.State.Health?.Status === 'unhealthy') {
        throw new Error('Target failed its health check');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Target ${target.id} did not become healthy before the startup deadline`);
  }
}

function buildContainerOptions(
  input: SpawnTargetInput,
  containerName: string,
  networkName: string,
): Docker.ContainerCreateOptions {
  const port = `${input.manifest.containerPort}/tcp`;
  return {
    name: containerName,
    Image: input.manifest.image,
    User: input.manifest.user,
    Cmd: input.manifest.command,
    Env: [`CYBER_RANGE_FLAG=${input.flag}`],
    Labels: managedLabels(input.instanceId, input.challengeId),
    ExposedPorts: { [port]: {} },
    StopTimeout: 10,
    Healthcheck: {
      Test: input.manifest.healthcheck.test,
      Interval: input.manifest.healthcheck.intervalSeconds * 1_000_000_000,
      Timeout: input.manifest.healthcheck.timeoutSeconds * 1_000_000_000,
      Retries: input.manifest.healthcheck.retries,
      StartPeriod: 2 * 1_000_000_000,
    },
    HostConfig: {
      AutoRemove: false,
      CapDrop: ['ALL'],
      Init: true,
      Memory: input.manifest.resources.memoryMb * 1_024 * 1_024,
      NanoCpus: Math.round(input.manifest.resources.cpuCores * 1_000_000_000),
      NetworkMode: networkName,
      PidsLimit: input.manifest.resources.pids,
      Privileged: false,
      ReadonlyRootfs: true,
      SecurityOpt: ['no-new-privileges:true', 'seccomp=default', 'apparmor=docker-default'],
      Tmpfs: {
        '/tmp': `rw,noexec,nosuid,nodev,size=${input.manifest.resources.tmpfsMb}m`,
      },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [networkName]: { Aliases: [containerName] },
      },
    },
  };
}

function managedLabels(instanceId: string, challengeId: string): Record<string, string> {
  return {
    [MANAGED_LABEL]: 'true',
    [INSTANCE_LABEL]: instanceId,
    [CHALLENGE_LABEL]: challengeId,
  };
}

function resourceNames(instanceId: string) {
  const suffix = instanceId.replaceAll('-', '');
  return { container: `cr-${suffix}`, network: `crn-${suffix}` };
}

function validateSpawnInput(input: SpawnTargetInput): void {
  if (input.manifest.challengeId !== input.challengeId) {
    throw new Error('Runtime manifest does not match the requested challenge');
  }
  if (!/^[A-Za-z0-9_-]{24,64}$/u.test(input.routeKey)) throw new Error('Invalid route key');
  if (!input.flag || input.flag.length > 256) throw new Error('Invalid runtime flag');
}

function assertManagedLabels(
  labels: Record<string, string> | undefined,
  instanceId: string,
): void {
  if (labels?.[MANAGED_LABEL] !== 'true' || labels[INSTANCE_LABEL] !== instanceId) {
    throw new Error('Refusing to remove a Docker resource without matching ownership labels');
  }
}

async function removeContainer(container: Docker.Container | undefined): Promise<void> {
  if (!container) return;
  await container.stop({ t: 10 }).catch((error: unknown) => {
    if (!isDockerNotFoundOrStopped(error)) throw error;
  });
  await container.remove({ force: true, v: true }).catch((error: unknown) => {
    if (!isDockerNotFound(error)) throw error;
  });
}

async function startContainer(container: Docker.Container): Promise<void> {
  await container.start().catch((error: unknown) => {
    if (!isDockerAlreadyStarted(error)) throw error;
  });
}

async function removeNetwork(network: Docker.Network | undefined): Promise<void> {
  if (!network) return;
  await network.remove().catch((error: unknown) => {
    if (!isDockerNotFound(error)) throw error;
  });
}

function isDockerNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404;
}

function isDockerNotFoundOrStopped(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error &&
    (error.statusCode === 304 || error.statusCode === 404);
}

function isDockerAlreadyStarted(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 304;
}
