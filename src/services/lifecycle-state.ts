import type { InstanceStatus } from './instance-lifecycle.js';

export type RuntimeInstanceState = {
  id: string;
  userId: string;
  challengeId: string;
  status: InstanceStatus;
  nodeId: string | null;
  routeKey: string | null;
  containerId: string | null;
  networkId: string | null;
  expiresAt: Date;
};

export type LifecycleStateRepository = {
  registerNode(name: string, now: Date): Promise<string>;
  prepareSpawn(input: {
    instanceId: string;
    nodeId: string;
    routeKey: string;
    now: Date;
  }): Promise<RuntimeInstanceState | null>;
  completeSpawn(input: {
    instanceId: string;
    containerId: string;
    networkId: string;
    now: Date;
  }): Promise<boolean>;
  completeStop(instanceId: string, status: 'stopped' | 'expired', now: Date): Promise<void>;
  markInstanceFailed(instanceId: string, failureCode: string, now: Date): Promise<void>;
  findInstance(instanceId: string): Promise<RuntimeInstanceState | null>;
};
