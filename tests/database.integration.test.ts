import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
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

  it('applies every Phase 1 identity table and remains ready', async () => {
    await expect(database.check()).resolves.toBeUndefined();

    const result = await database.db.execute(
      sql<{ table_name: string }>`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in ('users', 'user_profiles', 'sessions', 'email_tokens', 'audit_events')
        order by table_name
      `,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'audit_events',
      'email_tokens',
      'sessions',
      'user_profiles',
      'users',
    ]);
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
