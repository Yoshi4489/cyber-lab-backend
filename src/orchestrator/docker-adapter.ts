import type Docker from 'dockerode';
import type { RuntimeManifest, RuntimeService } from './runtime-manifests.js';
import type { TraefikRouter } from './traefik-router.js';
import type { ManagedRuntimeAllocation, ManagedRuntimeInventory } from '../services/runtime-inventory.js';

const MANAGED_LABEL = 'cyber-range.managed';
const INSTANCE_LABEL = 'cyber-range.instance-id';
const CHALLENGE_LABEL = 'cyber-range.challenge-id';
// On internal service containers only; the entry container has none.
const SERVICE_LABEL = 'cyber-range.service';
// On the entry: the services it needs, so status can notice one that disappeared.
const SERVICES_LABEL = 'cyber-range.services';
const FLAG_DELIVERY_TIMEOUT_MS = 15_000;
const ISOLATED_GATEWAY_OPTIONS = {
  'com.docker.network.bridge.gateway_mode_ipv4': 'isolated',
  'com.docker.network.bridge.gateway_mode_ipv6': 'isolated',
};

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

export type RuntimeStatus = 'healthy' | 'missing' | 'stopped' | 'oom' | 'unhealthy' | 'unsafe_network';

export class DockerOrchestrator {
  private hostVerified = false;

  constructor(
    private readonly docker: Docker,
    private readonly router: TraefikRouter,
    private readonly ingressContainer?: string,
    // Only the publication check sets this false, on disposable CI runners that lack userns remap.
    private readonly options: { verifyHost?: boolean } = {},
  ) {}

  /** Read-only inventory includes partial and orphan resources; it never deletes them. */
  async inventoryManagedResources(): Promise<ManagedRuntimeInventory> {
    const [containers, networks, routes] = await Promise.all([
      this.docker.listContainers({ all: true }),
      this.docker.listNetworks(),
      this.router.listInstanceIds(),
    ]);
    const allocations = new Map<string, ManagedRuntimeAllocation>();
    function allocationFor(instanceId: string): ManagedRuntimeAllocation {
      let allocation = allocations.get(instanceId);
      if (!allocation) {
        allocation = { instanceId, challengeId: null, containerId: null, networkId: null, routePresent: false };
        allocations.set(instanceId, allocation);
      }
      return allocation;
    }
    for (const [kind, resources] of [['containerId', containers], ['networkId', networks]] as const) {
      const seen = new Set<string>();
      for (const resource of resources) {
        const labels = resource.Labels;
        if (kind === 'containerId' && this.ingressContainer &&
          (resource.Id === this.ingressContainer || ('Names' in resource &&
            resource.Names?.includes(`/${this.ingressContainer}`))) && labels?.[MANAGED_LABEL] === 'true') {
          throw new Error('Trusted ingress cannot be labeled as a managed lab target');
        }
        if (labels?.[MANAGED_LABEL] !== 'true') {
          const names = 'Names' in resource ? resource.Names : ['Name' in resource ? resource.Name : ''];
          if (names?.some((name) => RESERVED_NAME.test(name ?? ''))) {
            throw new Error('Reserved lab resource names have missing ownership labels');
          }
          continue;
        }
        const instanceId = labels?.[INSTANCE_LABEL];
        const challengeId = labels?.[CHALLENGE_LABEL];
        if (labels?.[MANAGED_LABEL] !== 'true' || !isUuid(instanceId) || !isUuid(challengeId)) {
          throw new Error('Managed resource inventory has invalid ownership labels');
        }
        const names = resourceNames(instanceId);
        const service = kind === 'containerId' ? labels[SERVICE_LABEL] : undefined;
        if (service !== undefined && !SERVICE_NAME.test(service)) throw new Error('Managed resource has an invalid service label');
        const canonicalName = kind === 'containerId'
          ? 'Names' in resource && resource.Names?.includes(`/${containerName(instanceId, service)}`)
          : 'Name' in resource && resource.Name === names.network;
        if (!canonicalName) throw new Error('Managed resource name does not match its ownership labels');
        const slot = `${instanceId}/${service ?? ''}`;
        if (seen.has(slot)) {
          throw new Error('Managed resource inventory has duplicate allocations');
        }
        seen.add(slot);
        const allocation = allocationFor(instanceId);
        if (allocation.challengeId && allocation.challengeId !== challengeId) {
          throw new Error('Managed runtime resources have inconsistent challenge labels');
        }
        if (!resource.Id) throw new Error('Managed resource inventory is missing an identifier');
        allocation.challengeId = challengeId;
        if (service !== undefined) allocation.serviceContainerIds = [...allocation.serviceContainerIds ?? [], resource.Id];
        else allocation[kind] = resource.Id;
      }
    }
    for (const instanceId of routes) {
      if (!isUuid(instanceId)) throw new Error('Managed route inventory has invalid ownership');
      allocationFor(instanceId).routePresent = true;
    }
    return {
      allocations: [...allocations.values()],
      containerIds: containers.map((resource) => resource.Id),
      networkIds: networks.map((resource) => {
        if (!resource.Id) throw new Error('Network inventory is missing an identifier');
        return resource.Id;
      }),
    };
  }

  /** Complete every ownership read before returning any destructive operation. */
  async prepareManagedCleanup(allocations: readonly ManagedRuntimeAllocation[]): Promise<Array<() => Promise<void>>> {
    const ingress = this.ingressContainer ? await this.docker.getContainer(this.ingressContainer).inspect() : null;
    return Promise.all(allocations.map(async (allocation) => {
      if (!isUuid(allocation.instanceId)) throw new Error('Invalid cleanup instance identity');
      if ((allocation.containerId || allocation.networkId) && !isUuid(allocation.challengeId ?? undefined)) {
        throw new Error('Invalid cleanup challenge identity');
      }
      const names = resourceNames(allocation.instanceId);
      const container = allocation.containerId ? this.docker.getContainer(allocation.containerId) : null;
      const network = allocation.networkId ? this.docker.getNetwork(allocation.networkId) : null;
      const services = await Promise.all((allocation.serviceContainerIds ?? []).map(async (id) => {
        const service = this.docker.getContainer(id);
        const info = await service.inspect().catch((error: unknown) => { if (isDockerNotFound(error)) return null; throw error; });
        if (!info) return null;
        const name = info.Config?.Labels?.[SERVICE_LABEL];
        if (info.Id !== id || !name || info.Name !== `/${containerName(allocation.instanceId, name)}` ||
          (ingress && info.Id === ingress.Id)) {
          throw new Error('Refusing cleanup of a noncanonical service container');
        }
        assertManagedLabels(info.Config?.Labels, allocation.instanceId);
        if (info.Config?.Labels?.[CHALLENGE_LABEL] !== allocation.challengeId) throw new Error('Cleanup service challenge ownership changed');
        return service;
      }));
      const [containerInfo, networkInfo] = await Promise.all([
        container?.inspect().catch((error: unknown) => { if (isDockerNotFound(error)) return null; throw error; }),
        network?.inspect().catch((error: unknown) => { if (isDockerNotFound(error)) return null; throw error; }),
        allocation.routePresent ? this.router.validateManagedRoute(allocation.instanceId) : Promise.resolve(),
      ]);
      if (containerInfo) {
        if (containerInfo.Id !== allocation.containerId || containerInfo.Name !== `/${names.container}` ||
          (ingress && (containerInfo.Id === ingress.Id || containerInfo.Name === ingress.Name))) {
          throw new Error('Refusing cleanup of a noncanonical or trusted ingress container');
        }
        assertManagedLabels(containerInfo.Config?.Labels, allocation.instanceId);
        if (containerInfo.Config?.Labels?.[CHALLENGE_LABEL] !== allocation.challengeId) throw new Error('Cleanup container challenge ownership changed');
      }
      if (networkInfo) {
        if (networkInfo.Id !== allocation.networkId || networkInfo.Name !== names.network) throw new Error('Cleanup network identity changed');
        assertManagedLabels(networkInfo.Labels, allocation.instanceId);
        if (networkInfo.Labels?.[CHALLENGE_LABEL] !== allocation.challengeId) throw new Error('Cleanup network challenge ownership changed');
      }
      return async () => {
        if (allocation.routePresent) await this.router.remove(allocation.instanceId);
        if (container && containerInfo) await removeContainer(container);
        for (const service of services) if (service) await removeContainer(service);
        if (network && networkInfo) {
          // Detach only the actual trusted ingress ID. Other endpoints remain untouched.
          if (ingress && networkInfo.Containers?.[ingress.Id]) {
            await network.disconnect({ Container: ingress.Id, Force: true });
          }
          await removeDockerNetwork(network);
        }
      };
    }));
  }

  async spawn(input: SpawnTargetInput): Promise<SpawnedTarget> {
    validateSpawnInput(input);
    await this.verifyHostSecurity();
    const names = resourceNames(input.instanceId);
    const existing = await this.findContainers(input.instanceId);
    let network: Docker.Network | undefined;
    const containers = new Map<string, Docker.Container>();
    try {
      if (existing.size > 0) {
        // A retry resumes a partial start, which must still have its isolated network.
        const found = await this.findNetwork(input.instanceId);
        if (!found) throw new Error('Managed container is missing its isolated network');
        await assertManagedNetwork(found.network, input.instanceId, input.challengeId);
        network = found.network;
      } else {
        network = await this.ensureNetwork(input, names.network);
      }
      await this.ensureIngressConnected(network);
      // Internal services first, so the entry can reach them as soon as it starts.
      const serviceHosts: string[] = [];
      for (const service of [...input.manifest.services, null]) {
        const key = service?.name ?? '';
        // gVisor's netstack can't reach Docker's embedded DNS, so the entry resolves
        // its services through /etc/hosts entries built from their assigned addresses.
        const extraHosts = service || input.manifest.sandbox !== 'gvisor' ? [] : serviceHosts;
        const container = existing.get(key)?.container ??
          await this.docker.createContainer(buildContainerOptions(input, service, names.network, extraHosts));
        containers.set(key, container);
        await startContainer(container);
        if (service && input.manifest.sandbox === 'gvisor') {
          const address = (await container.inspect()).NetworkSettings?.Networks?.[names.network]?.IPAddress;
          if (!address) throw new Error(`Service ${service.name} has no address on the instance network`);
          serviceHosts.push(`${service.name}:${address}`);
        }
      }
      const delivery = input.manifest.flagDelivery;
      const target = containers.get(delivery.mode === 'exec' ? delivery.service ?? '' : '');
      if (!target) throw new Error('Flag delivery target is missing');
      await deliverFlag(target, input);
      await this.router.upsert({
        instanceId: input.instanceId,
        routeKey: input.routeKey,
        targetHost: names.container,
        targetPort: input.manifest.containerPort,
      });
      for (const [key, container] of containers) {
        const startup = input.manifest.services.find(({ name }) => name === key)?.healthcheck.startupSeconds;
        await this.waitUntilHealthy({ id: container.id, container }, startup ?? input.manifest.healthcheck.startupSeconds);
      }
      const entry = containers.get('');
      if (!entry) throw new Error('Entry container is missing');
      return { containerId: entry.id, networkId: network.id };
    } catch (error) {
      await this.router.remove(input.instanceId).catch(() => undefined);
      for (const { container } of existing.values()) await removeContainer(container).catch(() => undefined);
      for (const container of containers.values()) await removeContainer(container).catch(() => undefined);
      if (network) await this.removeNetwork(network).catch(() => undefined);
      throw error;
    }
  }

  async destroy(input: DestroyTargetInput): Promise<void> {
    await this.router.remove(input.instanceId);
    const entry = input.containerId ? await this.getManagedContainer(input.containerId, input.instanceId) : undefined;
    if (entry) await removeContainer(entry);
    for (const { container } of (await this.findContainers(input.instanceId)).values()) await removeContainer(container);
    const network = input.networkId
      ? await this.getManagedNetwork(input.networkId, input.instanceId)
      : (await this.findNetwork(input.instanceId))?.network;
    if (network) await this.removeNetwork(network);
  }

  async runtimeStatus(instanceId: string): Promise<RuntimeStatus> {
    const containers = await this.findContainers(instanceId);
    const entry = containers.get('');
    if (!entry) return 'missing';
    const entryDetails = await inspectOrNull(entry.container);
    if (!entryDetails) return 'missing';
    assertManagedLabels(entryDetails.Config?.Labels, instanceId);
    const expected = (entryDetails.Config?.Labels?.[SERVICES_LABEL] ?? '').split(',').filter(Boolean);
    // A lost internal service breaks the lab as surely as a lost entry.
    if (expected.some((name) => !containers.has(name)) || containers.size !== expected.length + 1) return 'missing';
    const states: Docker.ContainerInspectInfo[] = [];
    for (const { container } of containers.values()) {
      const details = container === entry.container ? entryDetails : await inspectOrNull(container);
      if (!details) return 'missing';
      assertManagedLabels(details.Config?.Labels, instanceId);
      if (details.State.OOMKilled) return 'oom';
      if (!details.State.Running) return 'stopped';
      if (details.State.Health?.Status === 'unhealthy') return 'unhealthy';
      states.push(details);
    }
    const network = await this.findNetwork(instanceId);
    if (!network) return 'unsafe_network';
    const networkDetails = await network.network.inspect().catch((error: unknown) => {
      if (isDockerNotFound(error)) return null;
      throw error;
    });
    if (!networkDetails) return 'unsafe_network';
    assertManagedLabels(networkDetails.Labels, instanceId);
    if (!meetsNetworkIsolation(networkDetails)) return 'unsafe_network';
    for (const details of states) {
      const attachedNetworks = Object.keys(details.NetworkSettings?.Networks ?? {});
      if (!details.Config?.Labels?.[CHALLENGE_LABEL] ||
          details.Config.Labels[CHALLENGE_LABEL] !== networkDetails.Labels?.[CHALLENGE_LABEL] ||
          attachedNetworks.length !== 1 || attachedNetworks[0] !== networkDetails.Name) {
        return 'unsafe_network';
      }
    }
    return 'healthy';
  }

  async preflight(manifests: readonly RuntimeManifest[]): Promise<void> {
    await this.verifyHostSecurity();
    if (!this.ingressContainer) throw new Error('Docker preflight requires an ingress container');
    if (manifests.length === 0) throw new Error('Docker preflight requires at least one runtime manifest');

    const ingress = await this.docker.getContainer(this.ingressContainer).inspect();
    if (!ingress.State.Running) throw new Error('Docker ingress container is not running');

    if (manifests.some((manifest) => manifest.sandbox === 'gvisor')) {
      const info = await this.docker.info();
      const runtimes = (info.Runtimes ?? {}) as Record<string, unknown>;
      if (!('runsc' in runtimes)) throw new Error('A lab requires the gVisor (runsc) runtime, which the Docker host does not advertise');
    }

    const images = manifests.flatMap((manifest) => [manifest.image, ...manifest.services.map(({ image }) => image)]);
    await Promise.all(images.map(async (image) => {
      await this.docker.getImage(image).inspect().catch((error: unknown) => {
        if (isDockerNotFound(error)) {
          throw new Error('A trusted runtime image is unavailable on the Docker host');
        }
        throw error;
      });
    }));
  }

  private async verifyHostSecurity(): Promise<void> {
    if (this.hostVerified || this.options.verifyHost === false) return;
    const info = await this.docker.info();
    const rawOptions: unknown = info.SecurityOptions;
    const options = Array.isArray(rawOptions)
      ? rawOptions.filter((option): option is string => typeof option === 'string')
          .map((option) => option.toLowerCase())
      : [];
    if (!options.some((option) => option.startsWith('name=userns'))) {
      throw new Error('Docker host is missing required userns isolation');
    }
    if (!options.some((option) => /^name=seccomp,profile=(builtin|default)$/u.test(option))) {
      throw new Error('Docker host is missing required seccomp isolation');
    }
    if (!options.some((option) => option.startsWith('name=apparmor'))) {
      throw new Error('Docker host is missing required apparmor isolation');
    }
    const major = typeof info.ServerVersion === 'string'
      ? Number(/^(\d+)\./u.exec(info.ServerVersion)?.[1]) : NaN;
    if (!Number.isInteger(major) || major < 28) {
      throw new Error('Docker Engine 28 or newer is required for isolated bridge gateways');
    }
    this.hostVerified = true;
  }

  private async ensureNetwork(input: SpawnTargetInput, name: string): Promise<Docker.Network> {
    const existing = await this.findNetwork(input.instanceId);
    if (existing) {
      await assertManagedNetwork(existing.network, input.instanceId, input.challengeId);
      return existing.network;
    }

    try {
      const created = await this.docker.createNetwork({
        Name: name,
        Driver: 'bridge',
        EnableIPv6: false,
        Internal: true,
        Attachable: false,
        CheckDuplicate: true,
        Labels: managedLabels(input.instanceId, input.challengeId),
        Options: { ...ISOLATED_GATEWAY_OPTIONS },
      });
      try {
        await assertManagedNetwork(created, input.instanceId, input.challengeId);
      } catch (error) {
        await removeDockerNetwork(created).catch(() => undefined);
        throw error;
      }
      return created;
    } catch (error) {
      if (!isDockerConflict(error)) throw error;
      const recovered = await this.findNetwork(input.instanceId);
      if (!recovered) throw error;
      await assertManagedNetwork(recovered.network, input.instanceId, input.challengeId);
      return recovered.network;
    }
  }

  private async ensureIngressConnected(network: Docker.Network): Promise<void> {
    if (!this.ingressContainer) return;
    const attached = async () => {
      const details = await network.inspect();
      return Object.values(details.Containers ?? {}).some(
        (container) => container.Name === this.ingressContainer,
      );
    };
    if (await attached()) return;
    try {
      await network.connect({ Container: this.ingressContainer });
    } catch (error) {
      if (!(await attached())) throw error;
    }
  }

  private async removeNetwork(network: Docker.Network): Promise<void> {
    const details = await network.inspect().catch((error: unknown) => {
      if (isDockerNotFound(error)) return null;
      throw error;
    });
    if (!details) return;
    if (this.ingressContainer) {
      const attached = Object.entries(details.Containers ?? {}).find(
        ([, container]) => container.Name === this.ingressContainer,
      );
      if (attached) await network.disconnect({ Container: attached[0], Force: true });
    }
    await removeDockerNetwork(network);
  }

  /** Every container of an instance, keyed by service name ('' for the entry). */
  private async findContainers(instanceId: string) {
    const containers = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [`${MANAGED_LABEL}=true`, `${INSTANCE_LABEL}=${instanceId}`] }),
    });
    const found = new Map<string, { id: string; container: Docker.Container }>();
    for (const match of containers) {
      const service = match.Labels?.[SERVICE_LABEL] ?? '';
      if (found.has(service)) throw new Error('Managed instance has duplicate service containers');
      found.set(service, { id: match.Id, container: this.docker.getContainer(match.Id) });
    }
    return found;
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

/** `service` null is the entry. Every container gets the same fixed security defaults. */
function buildContainerOptions(
  input: SpawnTargetInput,
  service: RuntimeService | null,
  networkName: string,
  extraHosts: string[] = [],
): Docker.ContainerCreateOptions {
  const spec = service ?? input.manifest;
  const name = containerName(input.instanceId, service?.name);
  const labels = managedLabels(input.instanceId, input.challengeId);
  if (service) labels[SERVICE_LABEL] = service.name;
  else if (input.manifest.services.length > 0) labels[SERVICES_LABEL] = input.manifest.services.map(({ name: next }) => next).join(',');
  return {
    name,
    Image: spec.image,
    User: spec.user,
    Cmd: spec.command,
    Env: !service && input.manifest.flagDelivery.mode === 'env' ? [`CYBER_RANGE_FLAG=${input.flag}`] : [],
    Labels: labels,
    ...(service ? {} : { ExposedPorts: { [`${input.manifest.containerPort}/tcp`]: {} } }),
    StopTimeout: 10,
    Healthcheck: {
      Test: spec.healthcheck.test,
      Interval: spec.healthcheck.intervalSeconds * 1_000_000_000,
      Timeout: spec.healthcheck.timeoutSeconds * 1_000_000_000,
      Retries: spec.healthcheck.retries,
      StartPeriod: 2 * 1_000_000_000,
    },
    HostConfig: {
      AutoRemove: false,
      // Shell labs run on the gVisor kernel, isolating learner code from the host kernel.
      ...(input.manifest.sandbox === 'gvisor' ? { Runtime: 'runsc' } : {}),
      ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
      CapDrop: ['ALL'],
      Init: true,
      Memory: spec.resources.memoryMb * 1_024 * 1_024,
      MemorySwap: spec.resources.memoryMb * 1_024 * 1_024,
      NanoCpus: Math.round(spec.resources.cpuCores * 1_000_000_000),
      NetworkMode: networkName,
      IpcMode: 'none',
      PidsLimit: spec.resources.pids,
      Privileged: false,
      ReadonlyRootfs: true,
      // The verified host's built-in seccomp profile applies when no override is set.
      SecurityOpt: ['no-new-privileges:true', 'apparmor=docker-default'],
      Tmpfs: {
        '/tmp': `rw,noexec,nosuid,nodev,size=${spec.resources.tmpfsMb}m`,
        // Shell labs get one exec-capable workspace; everything else stays noexec.
        ...(spec.workspace ? { [spec.workspace.path]: `rw,nosuid,nodev,size=${spec.workspace.sizeMb}m` } : {}),
      },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '2' } },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        // Services find each other by name: `app` for the entry, the service name otherwise.
        [networkName]: { Aliases: [name, service?.name ?? 'app'] },
      },
    },
  };
}

/**
 * Runs before the route exists, so no learner can observe the short-lived
 * process. The flag stays out of the container config and PID 1's environment.
 */
async function inspectOrNull(container: Docker.Container): Promise<Docker.ContainerInspectInfo | null> {
  return container.inspect().catch((error: unknown) => {
    if (isDockerNotFound(error)) return null;
    throw error;
  });
}

async function deliverFlag(container: Docker.Container, input: SpawnTargetInput): Promise<void> {
  const delivery = input.manifest.flagDelivery;
  if (delivery.mode !== 'exec') return;
  try {
    const exec = await container.exec({
      Cmd: delivery.command,
      User: delivery.user,
      Env: [`CYBER_RANGE_FLAG=${input.flag}`],
      AttachStdout: false,
      AttachStderr: false,
    });
    await exec.start({ Detach: true });
    const deadline = Date.now() + FLAG_DELIVERY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const details = await exec.inspect();
      if (!details.Running) {
        if (details.ExitCode === 0) return;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch {
    // Engine errors can echo request data; keep the flag out of logs and job failures.
  }
  throw new Error('Runtime flag delivery failed');
}

function managedLabels(instanceId: string, challengeId: string): Record<string, string> {
  return {
    [MANAGED_LABEL]: 'true',
    [INSTANCE_LABEL]: instanceId,
    [CHALLENGE_LABEL]: challengeId,
  };
}

const SERVICE_NAME = /^[a-z][a-z0-9]{1,15}$/u;
const RESERVED_NAME = /^\/?(?:cr-[0-9a-f]{32}(?:-[a-z][a-z0-9]{1,15})?|crn-[0-9a-f]{32})$/u;

function resourceNames(instanceId: string) {
  const suffix = instanceId.replaceAll('-', '');
  return { container: `cr-${suffix}`, network: `crn-${suffix}` };
}

function containerName(instanceId: string, service?: string): string {
  return service ? `${resourceNames(instanceId).container}-${service}` : resourceNames(instanceId).container;
}

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}

function validateSpawnInput(input: SpawnTargetInput): void {
  if (input.manifest.challengeId !== input.challengeId) {
    throw new Error('Runtime manifest does not match the requested challenge');
  }
  if (!/^[0-9a-f]{40}$/u.test(input.routeKey)) throw new Error('Invalid route key');
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

async function assertManagedNetwork(
  network: Docker.Network,
  instanceId: string,
  challengeId: string,
): Promise<void> {
  const details = await network.inspect();
  assertManagedLabels(details.Labels, instanceId);
  if (details.Labels?.[CHALLENGE_LABEL] !== challengeId) {
    throw new Error('Managed network challenge label does not match the requested challenge');
  }
  if (!meetsNetworkIsolation(details)) {
    throw new Error('Managed network does not meet isolation requirements');
  }
}

function meetsNetworkIsolation(details: Docker.NetworkInspectInfo): boolean {
  return details.Driver === 'bridge' && details.EnableIPv6 === false &&
    details.Internal && !details.Attachable &&
    Object.entries(ISOLATED_GATEWAY_OPTIONS).every(([key, value]) => details.Options?.[key] === value);
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

async function removeDockerNetwork(network: Docker.Network): Promise<void> {
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

function isDockerConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 409;
}
