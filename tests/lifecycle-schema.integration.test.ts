import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { seedCatalog } from '../src/db/catalog-seed.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { instanceOperations, instances, labNodes, users } from '../src/db/schema.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('lifecycle persistence constraints', () => {
  let database: DatabaseClient;

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedCatalog(database.db);
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  it('allows only one active instance per player', async () => {
    const userId = randomUUID();
    const nodeId = randomUUID();
    const challenge = CHALLENGE_DEFINITIONS[0];
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1_000);
    const absoluteExpiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1_000);

    try {
      await database.db.insert(users).values({
        id: userId,
        email: `lifecycle-${userId}@example.test`,
        passwordHash: 'test-only-placeholder-hash',
      });
      await database.db.insert(labNodes).values({ id: nodeId, name: `node-${nodeId}` });

      const [first] = await database.db
        .insert(instances)
        .values({ userId, challengeId: challenge.id, nodeId, expiresAt, absoluteExpiresAt })
        .returning({ id: instances.id });
      if (!first) throw new Error('Instance insert returned no id');

      await expect(
        database.db.insert(instances).values({
          userId,
          challengeId: challenge.id,
          nodeId,
          expiresAt,
          absoluteExpiresAt,
        }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });

      await database.db
        .update(instances)
        .set({ status: 'stopped', stoppedAt: new Date() })
        .where(eq(instances.id, first.id));
      await expect(
        database.db.insert(instances).values({
          userId,
          challengeId: challenge.id,
          nodeId,
          expiresAt,
          absoluteExpiresAt,
        }),
      ).resolves.toBeDefined();
    } finally {
      await database.db.delete(users).where(eq(users.id, userId));
      await database.db.delete(labNodes).where(eq(labNodes.id, nodeId));
    }
  });

  it('deduplicates lifecycle operations by player, type, and idempotency key', async () => {
    const userId = randomUUID();
    const challenge = CHALLENGE_DEFINITIONS[0];
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    const now = new Date();

    try {
      await database.db.insert(users).values({
        id: userId,
        email: `operation-${userId}@example.test`,
        passwordHash: 'test-only-placeholder-hash',
      });
      const [instance] = await database.db
        .insert(instances)
        .values({
          userId,
          challengeId: challenge.id,
          expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
          absoluteExpiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1_000),
        })
        .returning({ id: instances.id });
      if (!instance) throw new Error('Instance insert returned no id');

      const operation = {
        instanceId: instance.id,
        userId,
        type: 'spawn' as const,
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
      };
      await database.db.insert(instanceOperations).values(operation);
      await expect(database.db.insert(instanceOperations).values(operation)).rejects.toMatchObject({
        cause: { code: '23505' },
      });
    } finally {
      await database.db.delete(users).where(eq(users.id, userId));
    }
  });

  it('rejects an expiry beyond the absolute lifetime', async () => {
    const userId = randomUUID();
    const challenge = CHALLENGE_DEFINITIONS[0];
    if (!challenge) throw new Error('Challenge definitions must not be empty');
    const now = new Date();

    try {
      await database.db.insert(users).values({
        id: userId,
        email: `expiry-${userId}@example.test`,
        passwordHash: 'test-only-placeholder-hash',
      });
      await expect(
        database.db.insert(instances).values({
          userId,
          challengeId: challenge.id,
          expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1_000),
          absoluteExpiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    } finally {
      await database.db.delete(users).where(eq(users.id, userId));
    }
  });
});
