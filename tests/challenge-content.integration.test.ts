import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadChallengePackages } from '../src/catalog/packages.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { DrizzleChallengeContentRepository } from '../src/db/challenge-content-repository.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleProgressRepository } from '../src/db/progress-repository.js';
import { DrizzleScoringRepository } from '../src/db/scoring-repository.js';
import { auditEvents, challenges, solves, users } from '../src/db/schema.js';
import { dropDisposableDatabase, signToken, testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const SLUG = 'invoice-peek';

describeDatabase('challenge content, hints and walkthroughs', () => {
  const databaseName = `challenge_content_${randomUUID().replaceAll('-', '')}`;
  const instanceId = randomUUID();
  let owner: Pool;
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let scoring: DrizzleScoringRepository;
  let challengeId: string;
  let createdDatabase = false;

  async function newPlayer(): Promise<{ id: string; headers: { authorization: string } }> {
    const id = randomUUID();
    await database.db.insert(users).values({
      id, email: `content-${id}@example.test`, passwordHash: 'test-only-placeholder-hash', emailVerifiedAt: new Date(),
    });
    const token = await signToken('submissions:write profile:read', { subject: id });
    return { id, headers: { authorization: `Bearer ${token}` } };
  }
  const solve = (userId: string) => scoring.recordSubmission({
    userId, challengeId, instanceId, correct: true, now: new Date(),
  });

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    owner = new Pool({ connectionString: testDatabaseUrl });
    await owner.query(`create database "${databaseName}"`);
    createdDatabase = true;
    const url = new URL(testDatabaseUrl);
    url.pathname = `/${databaseName}`;
    database = createDatabase(url.href);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db, undefined, { publishLabs: true });
    const [row] = await database.db.select({ id: challenges.id }).from(challenges).where(eq(challenges.slug, SLUG));
    if (!row) throw new Error('Seeded lab is missing');
    challengeId = row.id;
    scoring = new DrizzleScoringRepository(database.db);
    app = await buildApp({ ...testConfig, LOCAL_DEV_TEST: true }, {
      sessionAuthorizer: { validateServiceSession: async () => ({ allowedScopes: ['submissions:write', 'profile:read'] }) },
      challengeContent: new DrizzleChallengeContentRepository(database.db),
      progress: new DrizzleProgressRepository(database.db),
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
    if (createdDatabase) await dropDisposableDatabase(owner, databaseName, /^challenge_content_[0-9a-f]{32}$/u);
    await owner?.end();
  });

  it('publishes real labs and hides samples only when asked', async () => {
    const published = await database.db.select({ slug: challenges.slug }).from(challenges).where(eq(challenges.published, true));
    expect(published.map(({ slug }) => slug).sort()).toEqual(['invoice-peek', 'log-viewer', 'ping-tool', 'staff-login']);
    await seedCatalog(database.db);
    expect(await database.db.select().from(challenges).where(eq(challenges.published, true))).not.toHaveLength(0);
    await seedCatalog(database.db, undefined, { publishLabs: true });
  });

  it('serves a public briefing with no hint bodies or walkthrough', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/challenges/${SLUG}/content` });
    expect(response.statusCode).toBe(200);
    const packages = await loadChallengePackages();
    const lab = packages.find(({ slug }) => slug === SLUG);
    expect(response.json()).toMatchObject({ hasWalkthrough: true, hints: [{ position: 1, cost: 10 }, { position: 2, cost: 25 }] });
    expect(response.body).not.toContain(lab?.hints[0]?.bodyMd);
    expect(response.body).not.toContain('## The flaw');
  });

  it('requires authentication for state and unlocks', async () => {
    expect((await app.inject({ method: 'GET', url: `/v1/challenges/${SLUG}/state` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/hints/1/unlock` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/walkthrough/unlock` })).statusCode).toBe(401);
  });

  it('charges a hint once, across retries, and reduces the award', async () => {
    const player = await newPlayer();
    const unlock = () => app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/hints/1/unlock`, headers: player.headers });
    const first = await unlock();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ costApplied: 10, unlockedHints: [{ position: 1, costApplied: 10 }], walkthroughMd: null });
    expect((await unlock()).json()).toMatchObject({ costApplied: 10 });
    expect((await solve(player.id))?.pointsAwarded).toBe(90);
    const audits = await database.db.select().from(auditEvents).where(eq(auditEvents.actorUserId, player.id));
    expect(audits.filter(({ eventType }) => eventType === 'challenge.hint_unlocked')).toHaveLength(1);
  });

  it('keeps one player unlocks from another', async () => {
    const [first, second] = [await newPlayer(), await newPlayer()];
    await app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/hints/1/unlock`, headers: first.headers });
    const state = await app.inject({ method: 'GET', url: `/v1/challenges/${SLUG}/state`, headers: second.headers });
    expect(state.json()).toMatchObject({ unlockedHints: [], costApplied: 0 });
  });

  it('forfeits points when the walkthrough is opened first, but records the solve', async () => {
    const player = await newPlayer();
    const opened = await app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/walkthrough/unlock`, headers: player.headers });
    expect(opened.json().walkthroughMd).toContain('## The flaw');
    expect(opened.json().forfeited).toBe(true);
    expect(await solve(player.id)).toMatchObject({ pointsAwarded: 0, firstSolve: true });
    const [recorded] = await database.db.select().from(solves).where(eq(solves.userId, player.id));
    expect(recorded?.points).toBe(0);
    const profile = await app.inject({ method: 'GET', url: `/v1/challenges/${SLUG}/state`, headers: player.headers });
    expect(profile.json()).toMatchObject({ solved: true, pointsAwarded: 0, forfeited: true });
  });

  it('gives the walkthrough and hints free after a solve, without changing the award', async () => {
    const player = await newPlayer();
    expect((await solve(player.id))?.pointsAwarded).toBe(100);
    const state = await app.inject({ method: 'GET', url: `/v1/challenges/${SLUG}/state`, headers: player.headers });
    expect(state.json().walkthroughMd).toContain('## The flaw');
    const hint = await app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/hints/2/unlock`, headers: player.headers });
    expect(hint.json()).toMatchObject({ pointsAwarded: 100, costApplied: 0, forfeited: false });
    const later = await app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/walkthrough/unlock`, headers: player.headers });
    expect(later.json()).toMatchObject({ pointsAwarded: 100, forfeited: false });
  });

  it('awards correctly when an unlock races a solve', async () => {
    const player = await newPlayer();
    const [, result] = await Promise.all([
      app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/hints/1/unlock`, headers: player.headers }),
      solve(player.id),
    ]);
    expect([90, 100]).toContain(result?.pointsAwarded);
    const state = await app.inject({ method: 'GET', url: `/v1/challenges/${SLUG}/state`, headers: player.headers });
    const body = state.json() as { pointsAwarded: number; costApplied: number };
    expect(body.pointsAwarded + body.costApplied).toBe(100);
  });

  it('returns 404 for unknown hints and unpublished challenges', async () => {
    const player = await newPlayer();
    expect((await app.inject({ method: 'POST', url: `/v1/challenges/${SLUG}/hints/9/unlock`, headers: player.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/challenges/sample-web-a/content' })).statusCode).toBe(404);
  });
});
