export const LIFECYCLE_QUEUE_NAME = 'instance-lifecycle';

export type LifecycleOperationType = 'spawn' | 'extend' | 'destroy' | 'reap' | 'reconcile';

export type LifecycleJobData = {
  operationId: string;
};

export type ClaimedLifecycleOperation = {
  id: string;
  type: LifecycleOperationType;
  attempts: number;
  instance: {
    id: string;
    userId: string;
    challengeId: string;
    status: 'pending' | 'provisioning' | 'running' | 'stopping' | 'stopped' | 'failed' | 'expired';
    nodeId: string | null;
    routeKey: string | null;
    containerId: string | null;
    networkId: string | null;
    expiresAt: Date;
    absoluteExpiresAt: Date;
  };
};

export type LifecycleJobRepository = {
  recoverStaleOperations(staleBefore: Date): Promise<void>;
  listPendingOperations(limit: number): Promise<Array<{ id: string; type: LifecycleOperationType }>>;
  markQueued(operationId: string, now: Date): Promise<void>;
  claimOperation(operationId: string, now: Date): Promise<ClaimedLifecycleOperation | null>;
  markSucceeded(operationId: string, now: Date): Promise<void>;
  markFailed(operationId: string, failureCode: string, now: Date): Promise<void>;
  createMaintenanceIntents(now: Date, reconciliationBucket: string): Promise<void>;
};

export type LifecycleOperationHandler = {
  handle(operation: ClaimedLifecycleOperation): Promise<void>;
};
