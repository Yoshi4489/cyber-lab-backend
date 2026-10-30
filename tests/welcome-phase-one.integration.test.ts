import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { createPasswordHasher } from '../src/auth/password.js';
import { CHALLENGE_DEFINITIONS, WELCOME_CHALLENGE_ID } from '../src/catalog/definitions.js';
import { DrizzleAuthRepository } from '../src/db/auth-repository.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { DrizzleCatalogRepository } from '../src/db/catalog-repository.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { challenges, solves, submissions } from '../src/db/schema.js';
import { AuthenticationService } from '../src/services/authentication.js';
import { loadWelcomeLabConfig, WELCOME_LAB_PUBLIC_FLAG } from '../src/welcome-lab-config.js';
import { dropDisposableDatabase, testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('Welcome accounts and explicit catalog seed', () => {
  // Mode toggling must never race another suite's ordinary catalog fixtures.
  const databaseName = `welcome_phase_one_${randomUUID().replaceAll('-', '')}`;
  const enabled = loadWelcomeLabConfig({
    NODE_ENV: 'test', WELCOME_LAB_TEST_ENABLED: 'true', WELCOME_LAB_FLAG: WELCOME_LAB_PUBLIC_FLAG,
  });
  const sendEmailVerification = vi.fn(async () => undefined);
  const sendPasswordReset = vi.fn(async () => undefined);
  const learners: Array<{ id: string; email: string; password: string }> = [];
  let owner: Pool;
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let createdDatabase = false;

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    owner = new Pool({ connectionString: testDatabaseUrl });
    await owner.query(`create database "${databaseName}"`);
    createdDatabase = true;
    const isolatedUrl = new URL(testDatabaseUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    database = createDatabase(isolatedUrl.href);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db);

    const accounts = new DrizzleAuthRepository(database.db);
    const passwords = createPasswordHasher({ memoryCost: 4 * 1024, timeCost: 1, parallelism: 1, hashLength: 32 });
    for (const label of ['a', 'b']) {
      const email = `welcome-${label}-${randomUUID()}@example.test`;
      const password = randomBytes(24).toString('base64url');
      const account = await accounts.seedAccount({
        email, passwordHash: await passwords.hash(password), displayName: `Welcome learner ${label}`,
        role: 'player', verifiedAt: new Date(),
      });
      learners.push({ id: account.id, email, password });
    }
    const authentication = await AuthenticationService.create({
      repository: accounts, passwordHasher: passwords,
      mailer: { sendEmailVerification, sendPasswordReset },
    });
    app = await buildApp({ ...testConfig, ...enabled }, {
      authentication, catalog: new DrizzleCatalogRepository(database.db),
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
    if (owner) {
      try {
        if (createdDatabase) {
          await dropDisposableDatabase(owner, databaseName, /^welcome_phase_one_[a-f0-9]{32}$/u);
        }
      } finally { await owner.end(); }
    }
  });

  async function auth(path: string, body: object) {
    return app.inject({
      method: 'POST', url: `/v1/auth/${path}`,
      headers: { authorization: `Bearer ${testConfig.BFF_AUTH_SECRET}` }, payload: body,
    });
  }

  it('keeps ordinary seed publication compatible and cannot be enabled by a catalog query', async () => {
    const welcome = await database.db.query.challenges.findFirst({ where: eq(challenges.id, WELCOME_CHALLENGE_ID) });
    expect(welcome).toMatchObject({ slug: 'welcome', title: 'Welcome', published: false, difficulty: 'easy', kind: 'web', points: 10 });
    const response = await app.inject('/v1/challenges?WELCOME_LAB_TEST_ENABLED=true&FRONTEND_MODE=live');
    expect(response.statusCode).toBe(200);
    const listed = response.json<{ challenges: Array<{ id: string }> }>().challenges;
    expect(listed.map(({ id }) => id).sort()).toEqual(CHALLENGE_DEFINITIONS.filter(({ published }) => published).map(({ id }) => id).sort());
    expect(listed.some(({ id }) => id === WELCOME_CHALLENGE_ID)).toBe(false);
    expect((await app.inject('/v1/challenges/welcome')).statusCode).toBe(404);
    expect(response.body.includes(WELCOME_LAB_PUBLIC_FLAG)).toBe(false);
  });

  it('authenticates two fresh verified learners, restores sessions, and revokes only the signed-out session', async () => {
    const active: Array<{ learner: (typeof learners)[number]; sessionToken: string; sessionId: string }> = [];
    for (const learner of learners) {
      const wrong = await auth('login', { email: learner.email, password: `${learner.password}-incorrect` });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json<{ code: string }>().code).toBe('UNAUTHORIZED');
      expect(wrong.body.includes(learner.password)).toBe(false);

      const login = await auth('login', { email: learner.email, password: learner.password });
      expect(login.statusCode).toBe(200);
      const session = login.json<{ sessionToken: string; sessionId: string; user: { id: string; role: string; emailVerified: boolean } }>();
      // Boolean assertions keep opaque session values out of failed-test output.
      expect(session.user.id === learner.id && session.user.role === 'player' && session.user.emailVerified).toBe(true);
      expect(typeof session.sessionToken === 'string' && session.sessionToken.length === 43).toBe(true);
      expect(login.body.includes(learner.password)).toBe(false);
      active.push({ learner, sessionToken: session.sessionToken, sessionId: session.sessionId });
    }
    for (const session of active) {
      const refreshed = await auth('session', { sessionToken: session.sessionToken });
      expect(refreshed.statusCode).toBe(200);
      const restored = refreshed.json<{ sessionId: string; user: { id: string } }>();
      expect(restored.sessionId === session.sessionId && restored.user.id === session.learner.id).toBe(true);
    }
    const [first, second] = active;
    if (!first || !second) throw new Error('Two fixture learners are required');
    expect((await auth('logout', { sessionToken: first.sessionToken })).statusCode).toBe(204);
    expect((await auth('session', { sessionToken: first.sessionToken })).statusCode).toBe(401);
    expect((await auth('session', { sessionToken: second.sessionToken })).statusCode).toBe(200);
    expect((await auth('logout', { sessionToken: second.sessionToken })).statusCode).toBe(204);
    expect((await auth('session', { sessionToken: second.sessionToken })).statusCode).toBe(401);
    expect(sendEmailVerification).not.toHaveBeenCalled();
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it('toggles only publication on explicit reseeding while retaining sample and Welcome solve history', async () => {
    const sample = CHALLENGE_DEFINITIONS[0];
    const [learnerA, learnerB] = learners;
    if (!sample || !learnerA || !learnerB) throw new Error('Historical fixture identities are required');
    async function recordHistory(userId: string, challengeId: string) {
      const [attempt] = await database.db.insert(submissions).values({
        userId, challengeId, instanceId: randomUUID(), correct: true, pointsAwarded: 10,
      }).returning({ id: submissions.id });
      if (!attempt) throw new Error('Expected a historical attempt');
      await database.db.insert(solves).values({ userId, challengeId, firstSubmissionId: attempt.id, points: 10 });
    }
    await recordHistory(learnerA.id, sample.id);
    await seedCatalog(database.db, enabled);
    await seedCatalog(database.db, enabled);
    await recordHistory(learnerB.id, WELCOME_CHALLENGE_ID);
    const history = await database.db.select().from(solves).where(inArray(solves.userId, learners.map(({ id }) => id))).orderBy(solves.userId);
    const attempts = await database.db.select().from(submissions).orderBy(submissions.id);
    const published = (await app.inject('/v1/challenges')).json<{ challenges: Array<{ id: string }> }>().challenges;
    expect(published.map(({ id }) => id)).toEqual([WELCOME_CHALLENGE_ID]);
    expect((await app.inject('/v1/challenges/welcome')).statusCode).toBe(200);
    expect((await app.inject(`/v1/challenges/${sample.slug}`)).statusCode).toBe(404);
    expect(await database.db.select({ id: challenges.id }).from(challenges)).toHaveLength(CHALLENGE_DEFINITIONS.length);

    await seedCatalog(database.db, loadWelcomeLabConfig({ WELCOME_LAB_TEST_ENABLED: 'false' }));
    expect((await app.inject('/v1/challenges/welcome')).statusCode).toBe(404);
    const restored = (await app.inject('/v1/challenges')).json<{ challenges: Array<{ id: string }> }>().challenges;
    expect(restored.map(({ id }) => id).sort()).toEqual(CHALLENGE_DEFINITIONS.filter(({ published: visible }) => visible).map(({ id }) => id).sort());
    expect(await database.db.select().from(solves).where(inArray(solves.userId, learners.map(({ id }) => id))).orderBy(solves.userId)).toEqual(history);
    expect(await database.db.select().from(submissions).orderBy(submissions.id)).toEqual(attempts);
    expect(await database.db.select({ id: challenges.id }).from(challenges)).toHaveLength(CHALLENGE_DEFINITIONS.length);
  });
});
