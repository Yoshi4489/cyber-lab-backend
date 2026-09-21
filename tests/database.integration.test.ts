import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { challenges, solves, submissions, users } from '../src/db/schema.js';
import { testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('PostgreSQL foundation', () => {
  let database: DatabaseClient;

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await migrate(database.db, { migrationsFolder: 'drizzle' });
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  it('applies every current table and remains ready', async () => {
    await expect(database.check()).resolves.toBeUndefined();

    const result = await database.db.execute(
      sql<{ table_name: string }>`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'users', 'user_profiles', 'sessions', 'email_tokens', 'audit_events',
            'challenges', 'submissions', 'solves'
          )
        order by table_name
      `,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'audit_events',
      'challenges',
      'email_tokens',
      'sessions',
      'solves',
      'submissions',
      'user_profiles',
      'users',
    ]);
  });

  it('seeds the reviewed catalog idempotently without flag-bearing columns', async () => {
    await seedCatalog(database.db);
    await seedCatalog(database.db);

    const rows = await database.db
      .select({
        id: challenges.id,
        slug: challenges.slug,
        title: challenges.title,
        summary: challenges.summary,
        category: challenges.category,
        difficulty: challenges.difficulty,
        points: challenges.points,
        kind: challenges.kind,
        tags: challenges.tags,
        definitionVersion: challenges.definitionVersion,
        published: challenges.published,
      })
      .from(challenges)
      .orderBy(challenges.id);
    expect(rows).toEqual([...CHALLENGE_DEFINITIONS].sort((left, right) => left.id.localeCompare(right.id)));

    const columns = await database.db.execute(
      sql<{ column_name: string }>`
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name in ('challenges', 'submissions', 'solves')
          and (column_name ilike '%flag%' or column_name ilike '%hash%')
      `,
    );
    expect(columns.rows).toEqual([]);
  });

  it('enforces one scored solve per user and challenge', async () => {
    const userId = randomUUID();
    const [challenge] = CHALLENGE_DEFINITIONS;
    if (!challenge) throw new Error('Challenge definitions must not be empty');

    try {
      await seedCatalog(database.db);
      await database.db.insert(users).values({
        id: userId,
        email: `solve-${userId}@example.test`,
        passwordHash: 'test-only-placeholder-hash',
      });
      const [firstSubmission, duplicateSubmission] = await database.db
        .insert(submissions)
        .values([
          {
            userId,
            challengeId: challenge.id,
            instanceId: randomUUID(),
            correct: true,
          },
          {
            userId,
            challengeId: challenge.id,
            instanceId: randomUUID(),
            correct: true,
          },
        ])
        .returning({ id: submissions.id });
      if (!firstSubmission || !duplicateSubmission) {
        throw new Error('Submission inserts returned no ids');
      }

      await database.db.insert(solves).values({
        userId,
        challengeId: challenge.id,
        firstSubmissionId: firstSubmission.id,
        points: challenge.points,
      });
      await expect(
        database.db.insert(solves).values({
          userId,
          challengeId: challenge.id,
          firstSubmissionId: duplicateSubmission.id,
          points: challenge.points,
        }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
    } finally {
      await database.db.delete(users).where(sql`${users.id} = ${userId}`);
    }
  });

  it('reports PostgreSQL readiness through the API', async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    const app = await buildApp(testConfig, {
      database: createDatabase(testDatabaseUrl),
    });

    try {
      const response = await app.inject('/readyz');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ready',
        checks: [{ name: 'postgres', status: 'ok' }],
      });
    } finally {
      await app.close();
    }
  });

  it('enforces normalized unique account emails in PostgreSQL', async () => {
    const id = randomUUID();
    const email = `migration-${id}@example.test`;

    try {
      await database.db.insert(users).values({
        id,
        email,
        passwordHash: 'test-only-placeholder-hash',
      });

      await expect(
        database.db.insert(users).values({
          email,
          passwordHash: 'another-test-only-placeholder-hash',
        }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });

      await expect(
        database.db.insert(users).values({
          email: `UPPER-${id}@example.test`,
          passwordHash: 'test-only-placeholder-hash',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    } finally {
      await database.db.delete(users).where(sql`${users.id} = ${id}`);
    }
  });
});
