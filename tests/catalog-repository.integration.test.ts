import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { buildApp } from '../src/app.js';
import { DrizzleCatalogRepository } from '../src/db/catalog-repository.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { challenges } from '../src/db/schema.js';
import { testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('PostgreSQL catalog', () => {
  let database: DatabaseClient;
  let repository: DrizzleCatalogRepository;

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db);
    repository = new DrizzleCatalogRepository(database.db);
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  it('returns sorted public metadata through the unchanged catalog fields', async () => {
    const app = await buildApp(testConfig, { catalog: repository });
    try {
      const response = await app.inject('/v1/challenges');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        source: 'database',
        challenges: expect.arrayContaining([
          expect.objectContaining({ id: CHALLENGE_DEFINITIONS[0]?.id }),
        ]),
      });
      expect(response.body).not.toContain('definitionVersion');
      expect(response.body).not.toContain('published');
      expect(response.body).not.toContain('CTF{');
    } finally {
      await app.close();
    }
  });

  it('excludes unpublished rows from lists, categories, and slug lookup', async () => {
    const id = randomUUID();
    const slug = `hidden-${id}`;
    try {
      await database.db.insert(challenges).values({
        id,
        slug,
        title: 'Hidden challenge',
        summary: 'Must never be returned from public catalog reads.',
        category: 'hidden',
        difficulty: 'easy',
        points: 10,
        kind: 'web',
        published: false,
      });

      await expect(repository.findPublishedChallengeBySlug(slug)).resolves.toBeNull();
      await expect(repository.listCategories()).resolves.not.toContain('hidden');
      await expect(repository.listPublishedChallenges()).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id })]),
      );
    } finally {
      await database.db.delete(challenges).where(eq(challenges.id, id));
    }
  });
});
