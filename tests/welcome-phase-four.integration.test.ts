import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { WELCOME_CHALLENGE_ID } from '../src/catalog/definitions.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleInstanceLifecycleRepository } from '../src/db/instance-lifecycle-repository.js';
import { DrizzleLifecycleJobRepository } from '../src/db/lifecycle-job-repository.js';
import { DrizzleLifecycleStateRepository } from '../src/db/lifecycle-state-repository.js';
import { DrizzleScoringRepository } from '../src/db/scoring-repository.js';
import { instanceOperations, instances, users } from '../src/db/schema.js';
import type { DockerOrchestrator, SpawnTargetInput } from '../src/orchestrator/docker-adapter.js';
import { RuntimeManifestRegistry } from '../src/orchestrator/runtime-manifests.js';
import { DockerLifecycleHandler } from '../src/services/docker-lifecycle-handler.js';
import { InstanceLifecycleService } from '../src/services/instance-lifecycle.js';
import { createRuntimeFlagDeriver, createSubmissionFlagPolicy } from '../src/services/runtime-flags.js';
import { SubmissionService } from '../src/services/submissions.js';
import { loadWelcomeLabConfig, WELCOME_LAB_PUBLIC_FLAG } from '../src/welcome-lab-config.js';
import { dropDisposableDatabase, signToken, testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Phase 4 control-plane isolation: two learners through the real API, database
 * and lifecycle state machine. Docker is a recording fake, so this proves the
 * ownership boundary and per-instance resource identities; real container,
 * network and route separation is VM acceptance evidence.
 */
describeDatabase('Welcome two-user isolation', () => {
  const databaseName = `welcome_phase_four_${randomUUID().replaceAll('-', '')}`;
  const welcome = loadWelcomeLabConfig({
    NODE_ENV: 'test', WELCOME_LAB_TEST_ENABLED: 'true', WELCOME_LAB_FLAG: WELCOME_LAB_PUBLIC_FLAG,
  });
  const secret = 'welcome-phase-four-secret-at-least-thirty-two-bytes';
  const learner = { a: randomUUID(), b: randomUUID() };
  const live = new Map<string, { containerId: string; networkId: string; routeKey: string; flag: string }>();
  const spawn = vi.fn(async (input: SpawnTargetInput) => {
    const target = { containerId: `container-${input.instanceId}`, networkId: `network-${input.instanceId}` };
    live.set(input.instanceId, { ...target, routeKey: input.routeKey, flag: input.flag });
    return target;
  });
  const destroy = vi.fn(async (input: { instanceId: string }) => { live.delete(input.instanceId); });
  let owner: Pool;
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let jobs: DrizzleLifecycleJobRepository;
  let state: DrizzleLifecycleStateRepository;
  let handler: DockerLifecycleHandler;
  let createdDatabase = false;
  const ids: { a?: string; b?: string } = {};

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    owner = new Pool({ connectionString: testDatabaseUrl });
    await owner.query(`create database "${databaseName}"`);
    createdDatabase = true;
    const isolatedUrl = new URL(testDatabaseUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    database = createDatabase(isolatedUrl.href);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db, welcome);
    for (const [label, id] of Object.entries(learner)) {
      await database.db.insert(users).values({
        id, email: `isolation-${label}-${id}@example.test`, passwordHash: 'test-only-placeholder-hash', emailVerifiedAt: new Date(),
      });
    }

    jobs = new DrizzleLifecycleJobRepository(database.db);
    state = new DrizzleLifecycleStateRepository(database.db);
    const nodeId = await state.registerNode(`isolation-node-${randomUUID()}`, 2, new Date());
    const manifests = new RuntimeManifestRegistry([{
      challengeId: WELCOME_CHALLENGE_ID,
      image: `sha256:${'c'.repeat(64)}`,
      containerPort: 8080,
      user: '65532:65532',
      healthcheck: { test: ['CMD', '/healthcheck'], intervalSeconds: 5, timeoutSeconds: 3, retries: 5, startupSeconds: 30 },
      resources: { memoryMb: 64, cpuCores: 0.25, pids: 32, tmpfsMb: 8 },
    }]);
    const orchestrator = {
      spawn, destroy,
      runtimeStatus: vi.fn(async () => 'healthy' as const),
      inventoryManagedResources: vi.fn(async () => ({ allocations: [], containerIds: [], networkIds: [] })),
    } as unknown as DockerOrchestrator;
    handler = new DockerLifecycleHandler(state, manifests, createRuntimeFlagDeriver(secret, welcome), orchestrator, nodeId);

    const lifecycle = new InstanceLifecycleService(
      new DrizzleInstanceLifecycleRepository(database.db), 'https://labs.example.test',
    );
    app = await buildApp({ ...testConfig, ...welcome }, {
      instances: lifecycle,
      submissions: new SubmissionService(
        new DrizzleScoringRepository(database.db), lifecycle, createSubmissionFlagPolicy(secret, welcome),
      ),
      sessionAuthorizer: {
        validateServiceSession: async () => ({
          user: { emailVerified: true },
          allowedScopes: ['instances:read', 'instances:write', 'submissions:write'],
        }),
      },
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
    if (owner) {
      try {
        if (createdDatabase) {
          await dropDisposableDatabase(owner, databaseName, /^welcome_phase_four_[a-f0-9]{32}$/u);
        }
      } finally { await owner.end(); }
    }
  });

  async function call(
    who: keyof typeof learner,
    scope: string,
    request: { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: object; idempotent?: boolean },
  ) {
    const token = await signToken(scope, { subject: learner[who], sessionId: randomUUID() });
    return app.inject({
      method: request.method, url: request.url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(request.idempotent ? { 'idempotency-key': `phase4:${randomUUID()}` } : {}),
      },
      ...(request.payload ? { payload: request.payload } : {}),
    });
  }

  /** Runs one accepted lifecycle operation the way the worker does. */
  async function work(operationId: string) {
    const claimed = await jobs.claimOperation(operationId, new Date());
    if (!claimed) throw new Error('Operation was not claimable');
    await handler.handle(claimed);
    await jobs.markSucceeded(operationId, new Date());
  }

  async function operationsFor(instanceId: string) {
    return database.db.select({ id: instanceOperations.id }).from(instanceOperations)
      .where(eq(instanceOperations.instanceId, instanceId));
  }

  it('gives each learner a distinct running instance, route and resources', async () => {
    for (const who of ['a', 'b'] as const) {
      const created = await call(who, 'instances:write', {
        method: 'POST', url: '/v1/instances', payload: { challengeId: WELCOME_CHALLENGE_ID }, idempotent: true,
      });
      expect(created.statusCode).toBe(202);
      ids[who] = created.json().instance.id;
      await work(created.json().operationId);
    }
    const [a, b] = [live.get(ids.a!), live.get(ids.b!)];
    expect(a && b).toBeTruthy();
    expect(new Set([a!.containerId, b!.containerId]).size).toBe(2);
    expect(new Set([a!.networkId, b!.networkId]).size).toBe(2);
    expect(a!.routeKey).not.toBe(b!.routeKey);
    // The shared public value is injected for both; it cannot prove per-user flags.
    expect([a!.flag, b!.flag]).toEqual([WELCOME_LAB_PUBLIC_FLAG, WELCOME_LAB_PUBLIC_FLAG]);

    for (const who of ['a', 'b'] as const) {
      const own = await call(who, 'instances:read', { method: 'GET', url: `/v1/instances/${ids[who]}` });
      expect(own.json()).toMatchObject({ status: 'running' });
      const other = who === 'a' ? b! : a!;
      expect(own.json().url).toContain(live.get(ids[who]!)!.routeKey);
      expect(own.body).not.toContain(other.routeKey);
    }
  });

  it('denies every foreign operation without disclosure or side effects', async () => {
    const before = await database.db.select().from(instances).where(eq(instances.id, ids.a!));
    const beforeOperations = (await operationsFor(ids.a!)).length;
    const attempts = [
      call('b', 'instances:read', { method: 'GET', url: `/v1/instances/${ids.a}` }),
      call('b', 'instances:write', { method: 'POST', url: `/v1/instances/${ids.a}/extend`, idempotent: true }),
      call('b', 'instances:write', { method: 'DELETE', url: `/v1/instances/${ids.a}`, idempotent: true }),
      call('b', 'submissions:write', {
        method: 'POST', url: '/v1/submissions',
        payload: { challengeId: WELCOME_CHALLENGE_ID, instanceId: ids.a, flag: WELCOME_LAB_PUBLIC_FLAG },
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
      expect(response.body).not.toContain(live.get(ids.a!)!.routeKey);
    }
    expect(await database.db.select().from(instances).where(eq(instances.id, ids.a!))).toEqual(before);
    expect(await operationsFor(ids.a!)).toHaveLength(beforeOperations);
  });

  it('stops A without affecting B, which still plays and scores', async () => {
    const bResources = { ...live.get(ids.b!)! };
    const stopped = await call('a', 'instances:write', { method: 'DELETE', url: `/v1/instances/${ids.a}`, idempotent: true });
    expect(stopped.statusCode).toBe(202);
    await work(stopped.json().operationId);

    expect(destroy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instanceId: ids.a }));
    expect(live.has(ids.a!)).toBe(false);
    expect(live.get(ids.b!)).toEqual(bResources);
    expect((await call('a', 'instances:read', { method: 'GET', url: `/v1/instances/${ids.a}` })).json())
      .toMatchObject({ status: 'stopped' });

    const b = await call('b', 'instances:read', { method: 'GET', url: `/v1/instances/${ids.b}` });
    expect(b.json()).toMatchObject({ status: 'running' });
    expect(b.json().url).toContain(bResources.routeKey);

    const inactive = await call('a', 'submissions:write', {
      method: 'POST', url: '/v1/submissions',
      payload: { challengeId: WELCOME_CHALLENGE_ID, instanceId: ids.a, flag: WELCOME_LAB_PUBLIC_FLAG },
    });
    expect(inactive.statusCode).toBe(404);
    const scored = await call('b', 'submissions:write', {
      method: 'POST', url: '/v1/submissions',
      payload: { challengeId: WELCOME_CHALLENGE_ID, instanceId: ids.b, flag: WELCOME_LAB_PUBLIC_FLAG },
    });
    expect(scored.json()).toEqual({ correct: true, points: 10, recorded: true, source: 'database' });
  });
});
