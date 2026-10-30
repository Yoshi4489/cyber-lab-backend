import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { DrizzleAuthRepository } from '../src/db/auth-repository.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleProgressRepository } from '../src/db/progress-repository.js';
import { DrizzleScoringRepository } from '../src/db/scoring-repository.js';
import { users } from '../src/db/schema.js';
import { signToken, testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('player progress and leaderboard', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseClient;
  const playerA = { id: '', email: `progress-a-${randomUUID()}@example.test` };
  const playerB = { id: '', email: `progress-b-${randomUUID()}@example.test` };
  const disabled = { id: '', email: `progress-disabled-${randomUUID()}@example.test` };
  const firstChallenge = CHALLENGE_DEFINITIONS[0];
  const secondChallenge = CHALLENGE_DEFINITIONS[1];

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    if (!firstChallenge || !secondChallenge) throw new Error('Two challenge definitions are required');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db);

    const auth = new DrizzleAuthRepository(database.db);
    playerA.id = (
      await auth.seedAccount({
        email: playerA.email,
        passwordHash: 'test-only-placeholder-hash',
        displayName: 'Progress Player A',
        role: 'player',
        verifiedAt: new Date(),
      })
    ).id;
    playerB.id = (
      await auth.seedAccount({
        email: playerB.email,
        passwordHash: 'test-only-placeholder-hash',
        displayName: 'Progress Player B',
        role: 'player',
        verifiedAt: new Date(),
      })
    ).id;
    disabled.id = (
      await auth.seedAccount({
        email: disabled.email,
        passwordHash: 'test-only-placeholder-hash',
        displayName: 'Disabled Progress Player',
        role: 'player',
        verifiedAt: new Date(),
      })
    ).id;
    await database.db.update(users).set({ status: 'disabled' }).where(eq(users.id, disabled.id));

    const scoring = new DrizzleScoringRepository(database.db);
    await scoring.recordSubmission({
      userId: playerA.id,
      challengeId: firstChallenge.id,
      instanceId: randomUUID(),
      correct: true,
      now: new Date('2026-09-21T07:00:00.000Z'),
    });
    await scoring.recordSubmission({
      userId: playerB.id,
      challengeId: secondChallenge.id,
      instanceId: randomUUID(),
      correct: true,
      now: new Date('2026-09-21T07:05:00.000Z'),
    });

    app = await buildApp(testConfig, {
      progress: new DrizzleProgressRepository(database.db),
      sessionAuthorizer: {
        validateServiceSession: async () => ({ allowedScopes: ['profile:read'] }),
      },
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (database) {
      const ids = [playerA.id, playerB.id, disabled.id].filter(Boolean);
      if (ids.length > 0) await database.db.delete(users).where(inArray(users.id, ids));
      await database.close();
    }
  });

  it('derives the current profile from the verified subject', async () => {
    if (!firstChallenge) throw new Error('Challenge definition is required');
    const token = await signToken('profile:read', { subject: playerA.id });
    const response = await app.inject({
      url: `/v1/profile?userId=${playerB.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      userId: playerA.id,
      displayName: 'Progress Player A',
      totalPoints: firstChallenge.points,
      solvedCount: 1,
      availableChallenges: CHALLENGE_DEFINITIONS.filter((challenge) => challenge.published).length,
      solves: [
        {
          challengeId: firstChallenge.id,
          points: firstChallenge.points,
          solvedAt: '2026-09-21T07:00:00.000Z',
        },
      ],
    });
    expect(response.body).not.toContain(playerB.id);
    expect(response.body).not.toContain(playerA.email);
  });

  it('publishes ranked display names without account identifiers or disabled users', async () => {
    const response = await app.inject('/v1/leaderboard');
    const body = response.json<{ entries: Array<{ displayName: string; rank: number }> }>();

    expect(response.statusCode).toBe(200);
    expect(body.entries.find((entry) => entry.displayName === 'Progress Player B')?.rank).toBeLessThan(
      body.entries.find((entry) => entry.displayName === 'Progress Player A')?.rank ?? Infinity,
    );
    expect(body.entries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ displayName: 'Disabled Progress Player' })]),
    );
    expect(response.body).not.toContain(playerA.id);
    expect(response.body).not.toContain(playerA.email);
  });
});
