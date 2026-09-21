import { createHash } from 'node:crypto';
import { conflict, notFound } from '../lib/errors.js';

export const INSTANCE_STATUSES = [
  'pending',
  'provisioning',
  'running',
  'stopping',
  'stopped',
  'failed',
  'expired',
] as const;

export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export type InstanceRecord = {
  id: string;
  userId: string;
  challengeId: string;
  status: InstanceStatus;
  routeKey: string | null;
  createdAt: Date;
  startedAt: Date | null;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  stoppedAt: Date | null;
  failureCode: string | null;
};

export type InstanceView = {
  id: string;
  challengeId: string;
  status: InstanceStatus;
  createdAt: string;
  startedAt: string | null;
  expiresAt: string;
  absoluteExpiresAt: string;
  stoppedAt: string | null;
  failureCode: string | null;
  url?: string;
};

export type InstanceMutation = {
  instance: InstanceRecord;
  operationId: string;
  replayed: boolean;
};

export type MutationFailure =
  | 'challenge_not_found'
  | 'instance_not_found'
  | 'active_instance_exists'
  | 'invalid_state'
  | 'lifetime_limit'
  | 'idempotency_conflict';

export type MutationResult =
  | { kind: 'accepted'; value: InstanceMutation }
  | { kind: MutationFailure };

export type InstanceLifecycleRepository = {
  createInstanceIntent(input: {
    userId: string;
    challengeId: string;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
    expiresAt: Date;
    absoluteExpiresAt: Date;
    correlationId?: string;
  }): Promise<MutationResult>;
  extendInstanceIntent(input: {
    userId: string;
    instanceId: string;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
    extensionMs: number;
    correlationId?: string;
  }): Promise<MutationResult>;
  destroyInstanceIntent(input: {
    userId: string;
    instanceId: string;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
    correlationId?: string;
  }): Promise<MutationResult>;
  findOwnedInstance(userId: string, instanceId: string): Promise<InstanceRecord | null>;
  findOwnedRunningInstance(
    userId: string,
    instanceId: string,
    now: Date,
  ): Promise<{ challengeId: string } | null>;
};

const DEFAULT_LIFETIME_MS = 60 * 60 * 1_000;
const ABSOLUTE_LIFETIME_MS = 2 * 60 * 60 * 1_000;
const EXTENSION_MS = 30 * 60 * 1_000;

export class InstanceLifecycleService {
  constructor(
    private readonly repository: InstanceLifecycleRepository,
    private readonly publicBaseUrl?: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(input: {
    userId: string;
    challengeId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<{ instance: InstanceView; operationId: string; replayed: boolean }> {
    const now = this.clock();
    const result = await this.repository.createInstanceIntent({
      ...input,
      requestHash: hashRequest({ challengeId: input.challengeId }),
      now,
      expiresAt: new Date(now.getTime() + DEFAULT_LIFETIME_MS),
      absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_LIFETIME_MS),
    });
    return this.resolveMutation(result);
  }

  async get(userId: string, instanceId: string): Promise<InstanceView> {
    const instance = await this.repository.findOwnedInstance(userId, instanceId);
    if (!instance) throw notFound('Challenge instance not found');
    return this.toView(instance);
  }

  async extend(input: {
    userId: string;
    instanceId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<{ instance: InstanceView; operationId: string; replayed: boolean }> {
    const result = await this.repository.extendInstanceIntent({
      ...input,
      requestHash: hashRequest({ instanceId: input.instanceId, action: 'extend' }),
      now: this.clock(),
      extensionMs: EXTENSION_MS,
    });
    return this.resolveMutation(result);
  }

  async destroy(input: {
    userId: string;
    instanceId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<{ instance: InstanceView; operationId: string; replayed: boolean }> {
    const result = await this.repository.destroyInstanceIntent({
      ...input,
      requestHash: hashRequest({ instanceId: input.instanceId, action: 'destroy' }),
      now: this.clock(),
    });
    return this.resolveMutation(result);
  }

  async findOwnedInstance(
    userId: string,
    instanceId: string,
  ): Promise<{ challengeId: string } | null> {
    return this.repository.findOwnedRunningInstance(userId, instanceId, this.clock());
  }

  private resolveMutation(result: MutationResult): {
    instance: InstanceView;
    operationId: string;
    replayed: boolean;
  } {
    if (result.kind === 'accepted') {
      return {
        instance: this.toView(result.value.instance),
        operationId: result.value.operationId,
        replayed: result.value.replayed,
      };
    }
    if (result.kind === 'challenge_not_found') throw notFound('Challenge not found');
    if (result.kind === 'instance_not_found') throw notFound('Challenge instance not found');
    if (result.kind === 'active_instance_exists') {
      throw conflict('A player can have only one active instance');
    }
    if (result.kind === 'lifetime_limit') {
      throw conflict('Instance has reached its two-hour lifetime limit');
    }
    if (result.kind === 'idempotency_conflict') {
      throw conflict('Idempotency key was already used for a different request');
    }
    throw conflict('Instance cannot perform that operation in its current state');
  }

  private toView(instance: InstanceRecord): InstanceView {
    const view: InstanceView = {
      id: instance.id,
      challengeId: instance.challengeId,
      status: instance.status,
      createdAt: instance.createdAt.toISOString(),
      startedAt: instance.startedAt?.toISOString() ?? null,
      expiresAt: instance.expiresAt.toISOString(),
      absoluteExpiresAt: instance.absoluteExpiresAt.toISOString(),
      stoppedAt: instance.stoppedAt?.toISOString() ?? null,
      failureCode: instance.failureCode,
    };
    if (instance.status === 'running' && instance.routeKey && this.publicBaseUrl) {
      view.url = new URL(`/labs/${instance.routeKey}/`, this.publicBaseUrl).toString();
    }
    return view;
  }
}

function hashRequest(value: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
