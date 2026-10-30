import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ServiceSessionAuthorizer } from '../src/auth/require-scope.js';
import {
  InstanceLifecycleService,
  type InstanceLifecycleRepository,
  type InstanceRecord,
} from '../src/services/instance-lifecycle.js';
import { signToken, testConfig, TEST_SESSION_ID, UUID_PATTERN } from './helpers.js';

describe('instance authorization and empty command boundaries', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let emailVerified: boolean;
  let validateServiceSession: ReturnType<typeof vi.fn<ServiceSessionAuthorizer['validateServiceSession']>>;
  let repository: InstanceLifecycleRepository;
  let instance: InstanceRecord;

  beforeEach(async () => {
    emailVerified = true;
    const now = new Date('2026-01-01T00:00:00.000Z');
    instance = {
      id: randomUUID(), userId: 'player-1', challengeId: randomUUID(), status: 'running',
      routeKey: null, createdAt: now, startedAt: now,
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-01-01T02:00:00.000Z'),
      stoppedAt: null, failureCode: null,
    };
    const accepted = () => Promise.resolve({
      kind: 'accepted' as const,
      value: { instance, operationId: randomUUID(), replayed: false },
    });
    repository = {
      createInstanceIntent: vi.fn(accepted),
      extendInstanceIntent: vi.fn(accepted),
      destroyInstanceIntent: vi.fn(accepted),
      findOwnedInstance: vi.fn(async (userId) => userId === instance.userId ? instance : null),
      findOwnedRunningInstance: vi.fn(async () => null),
    };
    validateServiceSession = vi.fn(async () => ({
      allowedScopes: ['instances:read', 'instances:write'],
      user: { emailVerified },
    }));
    app = await buildApp({ ...testConfig, INSTANCE_RATE_LIMIT_MAX: 50 }, {
      sessionAuthorizer: { validateServiceSession },
      instances: new InstanceLifecycleService(repository, undefined, () => now),
    });
  });

  afterEach(async () => { await app?.close(); });

  async function createRequest(token?: string) {
    return app.inject({
      method: 'POST', url: '/v1/instances',
      headers: { authorization: `Bearer ${token ?? await signToken('instances:write')}`, 'idempotency-key': 'create-boundary-001' },
      payload: { challengeId: instance.challengeId },
    });
  }

  it('rechecks live account verification with the same token and never persists forbidden creation', async () => {
    const token = await signToken('instances:write');
    emailVerified = false;
    const refused = await createRequest(token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'FORBIDDEN', correlationId: expect.stringMatching(UUID_PATTERN) });
    expect(refused.headers['x-request-id']).toBe(refused.json().correlationId);
    expect(repository.createInstanceIntent).not.toHaveBeenCalled();

    emailVerified = true;
    expect((await createRequest(token)).statusCode).toBe(202);
    expect(repository.createInstanceIntent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      userId: 'player-1', challengeId: instance.challengeId,
    }));

    emailVerified = false;
    expect((await createRequest(token)).statusCode).toBe(403);
    expect(repository.createInstanceIntent).toHaveBeenCalledTimes(1);
    expect(validateServiceSession).toHaveBeenCalledTimes(3);
  });

  it('does not trust verification claims in a signed token', async () => {
    emailVerified = false;
    const token = await new SignJWT({
      scope: 'instances:write', sid: TEST_SESSION_ID, emailVerified: true,
    }).setProtectedHeader({ alg: 'HS256' }).setSubject('player-1')
      .setIssuer(testConfig.SERVICE_TOKEN_ISSUER).setAudience(testConfig.SERVICE_TOKEN_AUDIENCE)
      .setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(testConfig.BACKEND_SERVICE_TOKEN_SECRET));
    expect((await createRequest(token)).statusCode).toBe(403);
    expect(repository.createInstanceIntent).not.toHaveBeenCalled();
  });

  it('fails closed for a session authorizer that omits current verification', async () => {
    validateServiceSession.mockResolvedValue({ allowedScopes: ['instances:write'] });
    expect((await createRequest()).statusCode).toBe(403);
    expect(repository.createInstanceIntent).not.toHaveBeenCalled();
  });

  it('authenticates signature, session and current scope before checking email or validating input', async () => {
    emailVerified = false;
    for (const token of ['invalid-token', await signToken('instances:read')]) {
      expect((await createRequest(token)).statusCode).toBe(401);
    }
    expect(validateServiceSession).not.toHaveBeenCalled();
    validateServiceSession.mockResolvedValueOnce({ allowedScopes: [], user: { emailVerified: false } });
    expect((await createRequest()).statusCode).toBe(401);
    validateServiceSession.mockRejectedValueOnce(new Error('postgres://secret:credential@private-host'));
    const unavailable = await createRequest();
    expect(unavailable.statusCode).toBe(401);
    expect(unavailable.body).not.toContain('private-host');
    expect(unavailable.body).not.toContain('credential');
    const malformed = await app.inject({ method: 'POST', url: '/v1/instances', payload: { userId: 'forged' } });
    expect(malformed.statusCode).toBe(401);
    expect(repository.createInstanceIntent).not.toHaveBeenCalled();
  });

  it('rejects acting-user, verification and runtime fields before persisting', async () => {
    const authorization = `Bearer ${await signToken('instances:write')}`;
    for (const fields of [
      { userId: 'forged' }, { emailVerified: true }, { privileged: true },
      { WELCOME_LAB_TEST_ENABLED: true }, { WELCOME_LAB_FLAG: 'public-placeholder' },
      { welcomeLabTestEnabled: true },
    ]) {
      const response = await app.inject({
        method: 'POST', url: '/v1/instances',
        headers: { authorization, 'idempotency-key': 'strict-create-001' },
        payload: { challengeId: instance.challengeId, ...fields },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(repository.createInstanceIntent).not.toHaveBeenCalled();
  });

  it.each(['extend', 'destroy'] as const)('rejects every nonempty %s body after authorization without invoking lifecycle', async (action) => {
    const method = action === 'extend' ? 'POST' : 'DELETE';
    const url = `/v1/instances/${instance.id}${action === 'extend' ? '/extend' : ''}`;
    const headers = {
      authorization: `Bearer ${await signToken('instances:write')}`,
      'idempotency-key': 'empty-command-001', 'content-type': 'application/json',
    };
    for (const body of ['{}', '{"userId":"forged"}', '{"privileged":true}', 'null', '[]', 'false', '0', '""']) {
      const response = await app.inject({ method, url, headers, payload: body });
      expect(response.statusCode, body).toBe(400);
      expect(response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(response.headers['x-request-id']).toBe(response.json().correlationId);
      expect(response.body).not.toContain('forged');
    }
    const plain = await app.inject({ method, url, headers: { ...headers, 'content-type': 'text/plain' }, payload: 'unexpected' });
    expect(plain.statusCode).toBe(400);
    const unauthenticated = await app.inject({ method, url, payload: {} });
    expect(unauthenticated.statusCode).toBe(401);
    const wrongScope = await app.inject({ method, url, headers: {
      ...headers, authorization: `Bearer ${await signToken('instances:read')}`,
    }, payload: '{}' });
    expect(wrongScope.statusCode).toBe(401);
    expect(repository.extendInstanceIntent).not.toHaveBeenCalled();
    expect(repository.destroyInstanceIntent).not.toHaveBeenCalled();
  });

  it('preserves owned reads, empty-body extension and stopping for unverified users', async () => {
    emailVerified = false;
    const authorization = `Bearer ${await signToken('instances:read instances:write')}`;
    const read = await app.inject({ url: `/v1/instances/${instance.id}`, headers: { authorization } });
    expect(read.statusCode).toBe(200);
    for (const action of ['extend', 'destroy']) {
      const response = await app.inject({
        method: action === 'extend' ? 'POST' : 'DELETE',
        url: `/v1/instances/${instance.id}${action === 'extend' ? '/extend' : ''}`,
        headers: { authorization, 'idempotency-key': `unverified-${action}-001` },
      });
      expect(response.statusCode).toBe(202);
    }
    expect(repository.extendInstanceIntent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: 'player-1' }));
    expect(repository.destroyInstanceIntent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: 'player-1' }));
  });
});
