import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { DrizzleScoringRepository } from '../src/db/scoring-repository.js';
import { auditEvents, solves, submissions, users } from '../src/db/schema.js';
import { HmacInstanceFlagService } from '../src/services/instance-flags.js';
import { SubmissionService } from '../src/services/submissions.js';
import { signToken, testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('transactional scoring', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseClient;
  const userId = randomUUID();
  const instanceId = randomUUID();
  const sessionId = randomUUID();
  const challenge = CHALLENGE_DEFINITIONS[0];
  const flags = new HmacInstanceFlagService(
    'scoring-integration-secret-at-least-thirty-two-bytes',
  );

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db);
    await database.db.insert(users).values({
      id: userId,
      email: `scoring-${userId}@example.test`,
      passwordHash: 'test-only-placeholder-hash',
    });

    const service = new SubmissionService(
      new DrizzleScoringRepository(database.db),
      {
        findOwnedInstance: async (candidateUserId, candidateInstanceId) =>
          candidateUserId === userId && candidateInstanceId === instanceId
            ? { challengeId: challenge.id }
            : null,
      },
      flags,
      () => new Date('2026-09-21T06:30:00.000Z'),
    );
    app = await buildApp(testConfig, {
      submissions: service,
      sessionAuthorizer: {
        validateServiceSession: async () => ({ allowedScopes: ['submissions:write'] }),
      },
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (database) {
      await database.db.delete(users).where(eq(users.id, userId));
      await database.close();
    }
  });

  it('awards a concurrent correct submission exactly once', async () => {
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    const flag = flags.derive({ userId, challengeId: challenge.id, instanceId });
    const token = await signToken('submissions:write', { subject: userId, sessionId });

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: 'POST',
          url: '/v1/submissions',
          headers: { authorization: `Bearer ${token}` },
          payload: { challengeId: challenge.id, instanceId, flag },
        }),
      ),
    );

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    const bodies = responses.map((response) => response.json());
    expect(bodies.every((body) => body.correct && body.recorded && body.source === 'database'))
      .toBe(true);
    expect(bodies.filter((body) => body.points === challenge.points)).toHaveLength(1);
    expect(bodies.filter((body) => body.points === 0)).toHaveLength(7);

    const solveRows = await database.db.select().from(solves).where(eq(solves.userId, userId));
    const submissionRows = await database.db
      .select()
      .from(submissions)
      .where(eq(submissions.userId, userId));
    expect(solveRows).toHaveLength(1);
    expect(submissionRows).toHaveLength(8);
    expect(submissionRows.reduce((total, row) => total + row.pointsAwarded, 0)).toBe(
      challenge.points,
    );
  });

  it('records a failed attempt without storing or returning its submitted flag', async () => {
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    const submittedFlag = 'CTF{distinct-wrong-flag-value}';
    const token = await signToken('submissions:write', { subject: userId, sessionId });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: { challengeId: challenge.id, instanceId, flag: submittedFlag },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      correct: false,
      points: 0,
      recorded: true,
      source: 'database',
    });
    expect(response.body).not.toContain(submittedFlag);

    const attempts = await database.db
      .select()
      .from(submissions)
      .where(eq(submissions.userId, userId));
    const audits = await database.db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, userId));
    expect(JSON.stringify({ attempts, audits })).not.toContain(submittedFlag);
    expect(attempts.filter((attempt) => !attempt.correct)).toHaveLength(1);
  });

  it('rejects a foreign instance before recording an attempt', async () => {
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    const foreignUserId = randomUUID();
    const token = await signToken('submissions:write', {
      subject: foreignUserId,
      sessionId: randomUUID(),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: { challengeId: challenge.id, instanceId, flag: 'CTF{wrong}' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      database.db.select().from(submissions).where(eq(submissions.userId, foreignUserId)),
    ).resolves.toEqual([]);
  });
});
