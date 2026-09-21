import { randomBytes } from 'node:crypto';
import type { DockerOrchestrator } from '../orchestrator/docker-adapter.js';
import type { RuntimeManifestRegistry } from '../orchestrator/runtime-manifests.js';
import type {
  ClaimedLifecycleOperation,
  LifecycleOperationHandler,
} from '../queue/contracts.js';
import type { InstanceFlagService } from './instance-flags.js';
import type { LifecycleStateRepository } from './lifecycle-state.js';

export class DockerLifecycleHandler implements LifecycleOperationHandler {
  constructor(
    private readonly state: LifecycleStateRepository,
    private readonly manifests: RuntimeManifestRegistry,
    private readonly flags: InstanceFlagService,
    private readonly orchestrator: DockerOrchestrator,
    private readonly nodeId: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async handle(operation: ClaimedLifecycleOperation): Promise<void> {
    if (operation.type === 'spawn') return this.spawn(operation);
    if (operation.type === 'destroy' || operation.type === 'reap') {
      return this.destroy(operation, operation.type === 'reap' ? 'expired' : 'stopped');
    }
    if (operation.type === 'reconcile') return this.reconcile(operation);
    // Extension changes only persisted expiry. The target gets no additional
    // Docker authority and reads no client-controlled runtime option.
  }

  private async spawn(operation: ClaimedLifecycleOperation): Promise<void> {
    const manifest = this.manifests.get(operation.instance.challengeId);
    if (!manifest) throw new Error('No trusted runtime manifest for challenge');
    const prepared = await this.state.prepareSpawn({
      instanceId: operation.instance.id,
      nodeId: this.nodeId,
      routeKey: randomBytes(24).toString('base64url'),
      now: this.clock(),
    });
    if (!prepared || prepared.status === 'running') return;
    if (!prepared.routeKey) throw new Error('Prepared instance has no route key');

    const target = await this.orchestrator.spawn({
      instanceId: prepared.id,
      challengeId: prepared.challengeId,
      routeKey: prepared.routeKey,
      flag: this.flags.derive({
        userId: prepared.userId,
        challengeId: prepared.challengeId,
        instanceId: prepared.id,
      }),
      manifest,
    });
    const accepted = await this.state.completeSpawn({
      instanceId: prepared.id,
      containerId: target.containerId,
      networkId: target.networkId,
      now: this.clock(),
    });
    if (!accepted) {
      await this.orchestrator.destroy({
        instanceId: prepared.id,
        containerId: target.containerId,
        networkId: target.networkId,
      });
    }
  }

  private async destroy(
    operation: ClaimedLifecycleOperation,
    status: 'stopped' | 'expired',
  ): Promise<void> {
    const instance = await this.state.findInstance(operation.instance.id);
    if (!instance) return;
    await this.orchestrator.destroy({
      instanceId: instance.id,
      containerId: instance.containerId,
      networkId: instance.networkId,
    });
    await this.state.completeStop(instance.id, status, this.clock());
  }

  private async reconcile(operation: ClaimedLifecycleOperation): Promise<void> {
    const instance = await this.state.findInstance(operation.instance.id);
    if (!instance) return;
    if (instance.status === 'pending' || instance.status === 'provisioning') {
      await this.spawn(operation);
      return;
    }
    if (instance.status === 'stopping') {
      await this.destroy(
        operation,
        instance.expiresAt <= this.clock() ? 'expired' : 'stopped',
      );
      return;
    }
    if (instance.status === 'running') {
      const exists = await this.orchestrator.hasManagedContainer(instance.id);
      if (!exists) {
        await this.state.markInstanceFailed(instance.id, 'runtime_missing', this.clock());
      }
      return;
    }
    await this.orchestrator.destroy({
      instanceId: instance.id,
      containerId: instance.containerId,
      networkId: instance.networkId,
    });
  }
}
