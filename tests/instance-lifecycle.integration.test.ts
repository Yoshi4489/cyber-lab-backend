import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createPasswordHasher } from '../src/auth/password.js';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { DrizzleAuthRepository } from '../src/db/auth-repository.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleInstanceLifecycleRepository } from '../src/db/instance-lifecycle-repository.js';
import { instanceOperations, instances, users } from '../src/db/schema.js';
import { InstanceLifecycleService } from '../src/services/instance-lifecycle.js';
import { AuthenticationService } from '../src/services/authentication.js';
import { signToken, testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('owned instance lifecycle API', () => {
  let database: DatabaseClient;
  let app: FastifyInstance;
  let ownerId: string;
  let otherUserId: string;
  let ownerSessionId: string;
  let otherSessionId: string;
  const now = new Date('2026-01-01T00:00:00.000Z');
  const challenge = CHALLENGE_DEFINITIONS[0];
  const otherChallenge = CHALLENGE_DEFINITIONS[1];

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    if (!challenge || !otherChallenge) throw new Error('Two challenge definitions are required');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db);
    const authRepository = new DrizzleAuthRepository(database.db);
    const passwordHasher = createPasswordHasher({ memoryCost: 4 * 1024, timeCost: 1, parallelism: 1, hashLength: 32 });
    const password = 'instance-fixture-password-long-enough';
    const passwordHash = await passwordHasher.hash(password);
    const ownerEmail = `instance-owner-${randomUUID()}@example.test`;
    const otherEmail = `instance-other-${randomUUID()}@example.test`;
    ownerId = (await authRepository.seedAccount({
      email: ownerEmail, passwordHash, displayName: 'Instance owner', role: 'player', verifiedAt: null,
    })).id;
    otherUserId = (await authRepository.seedAccount({
      email: otherEmail, passwordHash, displayName: 'Other instance player', role: 'player', verifiedAt: now,
    })).id;
    const authentication = await AuthenticationService.create({
      repository: authRepository,
      passwordHasher,
      mailer: { sendEmailVerification: async () => {}, sendPasswordReset: async () => {} },
      now: () => now,
    });
    ownerSessionId = (await authentication.login(ownerEmail, password)).sessionId;
    otherSessionId = (await authentication.login(otherEmail, password)).sessionId;
    const service = new InstanceLifecycleService(
      new DrizzleInstanceLifecycleRepository(database.db),
      'https://labs.example.test',
      () => now,
    );
    app = await buildApp(testConfig, {
      authentication,
      instances: service,
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await database?.db.delete(users).where(eq(users.id, ownerId));
    await database?.db.delete(users).where(eq(users.id, otherUserId));
    await database?.close();
  });

  it('creates pending intent idempotently and enforces the active quota', async () => {
    const authorization = `Bearer ${await signToken('instances:write', { subject: ownerId, sessionId: ownerSessionId })}`;
    const request = {
      method: 'POST' as const,
      url: '/v1/instances',
      headers: { authorization, 'idempotency-key': 'create-request-001' },
      payload: { challengeId: challenge?.id },
    };

    const forbidden = await app.inject(request);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(await database.db.select({ id: instances.id }).from(instances).where(eq(instances.userId, ownerId))).toHaveLength(0);
    expect(await database.db.select({ id: instanceOperations.id }).from(instanceOperations).where(eq(instanceOperations.userId, ownerId))).toHaveLength(0);

    // The same signed token must observe verification changed in PostgreSQL.
    await database.db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, ownerId));
    const created = await app.inject(request);
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({
      replayed: false,
      instance: { challengeId: challenge?.id, status: 'pending' },
    });
    expect(created.json().instance).not.toHaveProperty('url');
    expect(created.json().instance.expiresAt).toBe('2026-01-01T01:00:00.000Z');
    expect(created.json().instance.absoluteExpiresAt).toBe('2026-01-01T02:00:00.000Z');

    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({
      operationId: created.json().operationId,
      replayed: true,
      instance: { id: created.json().instance.id },
    });

    const changedRequest = await app.inject({
      ...request,
      payload: { challengeId: otherChallenge?.id },
    });
    expect(changedRequest.statusCode).toBe(409);
    expect(changedRequest.json()).toMatchObject({ code: 'CONFLICT' });

    const second = await app.inject({
      ...request,
      headers: { authorization, 'idempotency-key': 'create-request-002' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'CONFLICT' });
  });

  it('hides foreign instances and requires idempotency keys for mutations', async () => {
    const [instance] = await database.db
      .select({ id: instances.id })
      .from(instances)
      .where(eq(instances.userId, ownerId));
    if (!instance) throw new Error('Expected the instance fixture');

    const foreign = await app.inject({
      url: `/v1/instances/${instance.id}`,
      headers: {
        authorization: `Bearer ${await signToken('instances:read', { subject: otherUserId, sessionId: otherSessionId })}`,
      },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: 'NOT_FOUND' });

    const missingKey = await app.inject({
      method: 'DELETE',
      url: `/v1/instances/${instance.id}`,
      headers: {
        authorization: `Bearer ${await signToken('instances:write', { subject: ownerId, sessionId: ownerSessionId })}`,
      },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    for (const action of ['extend', 'destroy']) {
      const request = {
        method: action === 'extend' ? 'POST' as const : 'DELETE' as const,
        url: `/v1/instances/${instance.id}${action === 'extend' ? '/extend' : ''}`,
      };
      const ownerBody = await app.inject({
        ...request,
        headers: {
          authorization: `Bearer ${await signToken('instances:write', { subject: ownerId, sessionId: ownerSessionId })}`,
          'idempotency-key': `unexpected-body-${action}`,
        },
        payload: {},
      });
      expect(ownerBody.statusCode).toBe(400);
      expect(ownerBody.json()).toMatchObject({ code: 'INVALID_REQUEST' });

      const foreignCommand = await app.inject({
        ...request,
        headers: {
          authorization: `Bearer ${await signToken('instances:write', { subject: otherUserId, sessionId: otherSessionId })}`,
          'idempotency-key': `foreign-command-${action}`,
        },
      });
      expect(foreignCommand.statusCode).toBe(404);
      expect(foreignCommand.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await database.db.select({ id: instanceOperations.id }).from(instanceOperations).where(eq(instanceOperations.userId, ownerId))).toHaveLength(1);
    expect(await database.db.select({ id: instanceOperations.id }).from(instanceOperations).where(eq(instanceOperations.userId, otherUserId))).toHaveLength(0);
  });

  it('reveals the route only when running, extends once, and destroys safely', async () => {
    const [pending] = await database.db
      .select({ id: instances.id })
      .from(instances)
      .where(eq(instances.userId, ownerId));
    if (!pending) throw new Error('Expected the instance fixture');
    const routeKey = randomUUID().replaceAll('-', '');
    await database.db
      .update(instances)
      .set({ status: 'running', routeKey, startedAt: now, updatedAt: now })
      .where(eq(instances.id, pending.id));

    // Removing verification must not lock an owner out of their existing target.
    await database.db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, ownerId));
    const readAuthorization = `Bearer ${await signToken('instances:read', { subject: ownerId, sessionId: ownerSessionId })}`;
    const running = await app.inject({
      url: `/v1/instances/${pending.id}`,
      headers: { authorization: readAuthorization },
    });
    expect(running.statusCode).toBe(200);
    expect(running.json()).toMatchObject({
      status: 'running',
      url: `https://labs.example.test/labs/${routeKey}/`,
    });

    const writeAuthorization = `Bearer ${await signToken('instances:write', { subject: ownerId, sessionId: ownerSessionId })}`;
    const extendRequest = {
      method: 'POST' as const,
      url: `/v1/instances/${pending.id}/extend`,
      headers: { authorization: writeAuthorization, 'idempotency-key': 'extend-request-001' },
    };
    const extended = await app.inject(extendRequest);
    expect(extended.statusCode).toBe(202);
    expect(extended.json()).toMatchObject({ replayed: false });
    expect(extended.json().instance.expiresAt).toBe('2026-01-01T01:30:00.000Z');
    expect((await app.inject(extendRequest)).json()).toMatchObject({
      operationId: extended.json().operationId,
      replayed: true,
    });

    const concurrentExtensions = await Promise.all([
      app.inject({
        ...extendRequest,
        headers: { authorization: writeAuthorization, 'idempotency-key': 'extend-request-002' },
      }),
      app.inject({
        ...extendRequest,
        headers: { authorization: writeAuthorization, 'idempotency-key': 'extend-request-003' },
      }),
    ]);
    expect(concurrentExtensions.map(({ statusCode }) => statusCode).sort()).toEqual([202, 409]);
    expect(concurrentExtensions.find(({ statusCode }) => statusCode === 202)?.json().instance.expiresAt)
      .toBe('2026-01-01T02:00:00.000Z');

    const destroyRequest = {
      method: 'DELETE' as const,
      url: `/v1/instances/${pending.id}`,
      headers: { authorization: writeAuthorization, 'idempotency-key': 'destroy-request-001' },
    };
    const destroyed = await app.inject(destroyRequest);
    expect(destroyed.statusCode).toBe(202);
    expect(destroyed.json()).toMatchObject({
      replayed: false,
      instance: { status: 'stopping' },
    });
    expect(destroyed.json().instance).not.toHaveProperty('url');
    expect((await app.inject(destroyRequest)).json()).toMatchObject({
      operationId: destroyed.json().operationId,
      replayed: true,
    });

    const operations = await database.db
      .select({ id: instanceOperations.id })
      .from(instanceOperations)
      .where(eq(instanceOperations.userId, ownerId));
    expect(operations).toHaveLength(4);
  });
});
