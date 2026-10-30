import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CHALLENGE_DEFINITIONS, WELCOME_CHALLENGE_ID } from '../src/catalog/definitions.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleInstanceLifecycleRepository } from '../src/db/instance-lifecycle-repository.js';
import { DrizzleProgressRepository } from '../src/db/progress-repository.js';
import { DrizzleScoringRepository } from '../src/db/scoring-repository.js';
import { auditEvents, challenges, instances, solves, submissions, userProfiles, users } from '../src/db/schema.js';
import { InstanceLifecycleService } from '../src/services/instance-lifecycle.js';
import { createSubmissionFlagPolicy } from '../src/services/runtime-flags.js';
import { SubmissionService } from '../src/services/submissions.js';
import { loadWelcomeLabConfig, WELCOME_LAB_PUBLIC_FLAG } from '../src/welcome-lab-config.js';
import { dropDisposableDatabase, signToken, testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('Welcome submission and persistence', () => {
  // Welcome seeding unpublishes the samples, so it must not share a catalog.
  const databaseName = `welcome_phase_three_${randomUUID().replaceAll('-', '')}`;
  const enabled = loadWelcomeLabConfig({
    NODE_ENV: 'test', WELCOME_LAB_TEST_ENABLED: 'true', WELCOME_LAB_FLAG: WELCOME_LAB_PUBLIC_FLAG,
  });
  const now = new Date('2026-10-27T09:00:00.000Z');
  const secret = 'welcome-phase-three-secret-at-least-thirty-two-bytes';
  const policy = createSubmissionFlagPolicy(secret, enabled);
  const sample = CHALLENGE_DEFINITIONS.find((definition) => definition.id !== WELCOME_CHALLENGE_ID);
  const learner = { a: randomUUID(), b: randomUUID(), sample: randomUUID(), stopped: randomUUID(), expired: randomUUID() };
  const instance: Record<keyof typeof learner, string> = { a: '', b: '', sample: '', stopped: '', expired: '' };
  let owner: Pool;
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let createdDatabase = false;

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    if (!sample) throw new Error('A non-Welcome challenge definition is required');
    owner = new Pool({ connectionString: testDatabaseUrl });
    await owner.query(`create database "${databaseName}"`);
    createdDatabase = true;
    const isolatedUrl = new URL(testDatabaseUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    database = createDatabase(isolatedUrl.href);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db, enabled);
    // Welcome mode unpublishes the samples; republish one here only to prove
    // the shared value never verifies for a scorable non-Welcome challenge.
    await database.db.update(challenges).set({ published: true }).where(eq(challenges.id, sample.id));

    for (const [label, id] of Object.entries(learner)) {
      await database.db.insert(users).values({
        id, email: `welcome-${label}-${id}@example.test`,
        passwordHash: 'test-only-placeholder-hash', emailVerifiedAt: now,
      });
      await database.db.insert(userProfiles).values({ userId: id, displayName: `Welcome ${label}` });
    }
    const hour = 60 * 60 * 1_000;
    const rows = {
      a: { challengeId: WELCOME_CHALLENGE_ID, status: 'running', expiresAt: new Date(now.getTime() + hour) },
      b: { challengeId: WELCOME_CHALLENGE_ID, status: 'running', expiresAt: new Date(now.getTime() + hour) },
      sample: { challengeId: sample.id, status: 'running', expiresAt: new Date(now.getTime() + hour) },
      stopped: { challengeId: WELCOME_CHALLENGE_ID, status: 'stopped', expiresAt: new Date(now.getTime() + hour) },
      expired: { challengeId: WELCOME_CHALLENGE_ID, status: 'running', expiresAt: new Date(now.getTime() - 1_000) },
    } as const;
    for (const label of Object.keys(learner) as Array<keyof typeof learner>) {
      const [row] = await database.db.insert(instances).values({
        userId: learner[label], ...rows[label], createdAt: now, updatedAt: now,
        absoluteExpiresAt: new Date(now.getTime() + 2 * hour),
      }).returning({ id: instances.id });
      if (!row) throw new Error('Instance insert returned no id');
      instance[label] = row.id;
    }

    const lifecycle = new InstanceLifecycleService(
      new DrizzleInstanceLifecycleRepository(database.db), undefined, () => now,
    );
    app = await buildApp({ ...testConfig, ...enabled }, {
      submissions: new SubmissionService(
        new DrizzleScoringRepository(database.db), lifecycle, policy, () => now,
      ),
      progress: new DrizzleProgressRepository(database.db),
      sessionAuthorizer: {
        validateServiceSession: async () => ({ allowedScopes: ['submissions:write', 'profile:read'] }),
      },
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
    if (owner) {
      try {
        if (createdDatabase) {
          await dropDisposableDatabase(owner, databaseName, /^welcome_phase_three_[a-f0-9]{32}$/u);
        }
      } finally { await owner.end(); }
    }
  });

  async function submit(
    userId: string,
    payload: { challengeId: string; instanceId: string; flag: unknown },
  ) {
    const token = await signToken('submissions:write', { subject: userId, sessionId: randomUUID() });
    return app.inject({
      method: 'POST', url: '/v1/submissions', headers: { authorization: `Bearer ${token}` }, payload,
    });
  }

  async function attempts(userId: string) {
    return database.db.select().from(submissions).where(eq(submissions.userId, userId));
  }

  it('records an incorrect Welcome attempt for zero points without echoing it', async () => {
    for (const flag of ['FLAG{welcome_to_cisco_family}', 'FLAG{WELCOME}', 'CTF{not-the-welcome-value}']) {
      const response = await submit(learner.a, { challengeId: WELCOME_CHALLENGE_ID, instanceId: instance.a, flag });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ correct: false, points: 0, recorded: true, source: 'database' });
      expect(response.body).not.toContain(flag);
    }
    expect(await attempts(learner.a)).toHaveLength(3);
  });

  it('awards 10 points exactly once across concurrent correct attempts', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      submit(learner.a, {
        challengeId: WELCOME_CHALLENGE_ID,
        instanceId: instance.a,
        flag: index === 0 ? `  ${WELCOME_LAB_PUBLIC_FLAG}\n` : WELCOME_LAB_PUBLIC_FLAG,
      })));
    const bodies = responses.map((response) => response.json());
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(bodies.every((body) => body.correct && body.recorded && body.source === 'database')).toBe(true);
    expect(bodies.filter((body) => body.points === 10)).toHaveLength(1);
    expect(bodies.filter((body) => body.points === 0)).toHaveLength(5);
    for (const response of responses) expect(response.body).not.toContain(WELCOME_LAB_PUBLIC_FLAG);

    const repeat = await submit(learner.a, { challengeId: WELCOME_CHALLENGE_ID, instanceId: instance.a, flag: WELCOME_LAB_PUBLIC_FLAG });
    expect(repeat.json()).toEqual({ correct: true, points: 0, recorded: true, source: 'database' });

    const solveRows = await database.db.select().from(solves).where(eq(solves.userId, learner.a));
    expect(solveRows).toHaveLength(1);
    expect((await attempts(learner.a)).reduce((total, row) => total + row.pointsAwarded, 0)).toBe(10);
    const [running] = await database.db.select({ status: instances.status }).from(instances)
      .where(eq(instances.id, instance.a));
    expect(running?.status).toBe('running');
  });

  it('awards a second learner independently from the shared public value', async () => {
    const response = await submit(learner.b, { challengeId: WELCOME_CHALLENGE_ID, instanceId: instance.b, flag: WELCOME_LAB_PUBLIC_FLAG });
    expect(response.json()).toEqual({ correct: true, points: 10, recorded: true, source: 'database' });
  });

  it('never accepts the Welcome value for another challenge', async () => {
    if (!sample) throw new Error('A non-Welcome challenge definition is required');
    const welcomeValue = await submit(learner.sample, { challengeId: sample.id, instanceId: instance.sample, flag: WELCOME_LAB_PUBLIC_FLAG });
    expect(welcomeValue.json()).toMatchObject({ correct: false, points: 0 });
    const dynamic = policy.derive({ userId: learner.sample, challengeId: sample.id, instanceId: instance.sample });
    expect(dynamic).not.toBe(WELCOME_LAB_PUBLIC_FLAG);
    const correct = await submit(learner.sample, { challengeId: sample.id, instanceId: instance.sample, flag: dynamic });
    expect(correct.json()).toMatchObject({ correct: true, points: sample.points });
  });

  it('denies foreign, mismatched, stopped and expired instances before recording', async () => {
    const denied = [
      [learner.b, { challengeId: WELCOME_CHALLENGE_ID, instanceId: instance.a }],
      [learner.sample, { challengeId: WELCOME_CHALLENGE_ID, instanceId: instance.sample }],
      [learner.stopped, { challengeId: WELCOME_CHALLENGE_ID, instanceId: instance.stopped }],
      [learner.expired, { challengeId: WELCOME_CHALLENGE_ID, instanceId: instance.expired }],
    ] as const;
    const before = await Promise.all([learner.b, learner.sample, learner.stopped, learner.expired].map(attempts));
    for (const [userId, target] of denied) {
      const response = await submit(userId, { ...target, flag: WELCOME_LAB_PUBLIC_FLAG });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
    const after = await Promise.all([learner.b, learner.sample, learner.stopped, learner.expired].map(attempts));
    expect(after.map((rows) => rows.length)).toEqual(before.map((rows) => rows.length));
  });

  it('rejects malformed submissions before recording', async () => {
    const before = (await attempts(learner.b)).length;
    for (const payload of [
      { challengeId: WELCOME_CHALLENGE_ID, instanceId: instance.b, flag: 42 },
      { challengeId: 'welcome', instanceId: instance.b, flag: WELCOME_LAB_PUBLIC_FLAG },
      { challengeId: WELCOME_CHALLENGE_ID, instanceId: instance.b, flag: WELCOME_LAB_PUBLIC_FLAG, userId: learner.a },
    ]) {
      expect((await submit(learner.b, payload)).statusCode).toBe(400);
    }
    expect(await attempts(learner.b)).toHaveLength(before);
  });

  it('reflects the single award in profile and leaderboard reads without flag material', async () => {
    const token = await signToken('profile:read', { subject: learner.a, sessionId: randomUUID() });
    const profile = await app.inject({ url: '/v1/profile', headers: { authorization: `Bearer ${token}` } });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ userId: learner.a, totalPoints: 10, solvedCount: 1 });
    expect(profile.json().solves).toEqual([expect.objectContaining({ challengeId: WELCOME_CHALLENGE_ID, points: 10 })]);

    const leaderboard = await app.inject('/v1/leaderboard');
    expect(leaderboard.statusCode).toBe(200);
    const rows = leaderboard.json().entries as Array<{ displayName: string; totalPoints: number }>;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: 'Welcome a', totalPoints: 10, solvedCount: 1 }),
      expect.objectContaining({ displayName: 'Welcome b', totalPoints: 10, solvedCount: 1 }),
    ]));
    const audits = await database.db.select({ details: auditEvents.details }).from(auditEvents);
    for (const body of [profile.body, leaderboard.body, JSON.stringify(audits)]) {
      expect(body).not.toContain(WELCOME_LAB_PUBLIC_FLAG);
    }
  });
});
