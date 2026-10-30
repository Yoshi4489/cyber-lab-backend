import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashOpaqueToken } from '../src/auth/opaque-token.js';
import { DrizzleAuthRepository } from '../src/db/auth-repository.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('authentication repository', () => {
  let database: DatabaseClient;
  let repository: DrizzleAuthRepository;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    repository = new DrizzleAuthRepository(database.db);
  }, 30_000);

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await database.db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await database?.close();
  });

  async function seedPlayer() {
    const email = `repository-${randomUUID()}@example.test`;
    const result = await repository.seedAccount({
      email,
      passwordHash: 'original-test-hash',
      displayName: 'Repository Player',
      role: 'player',
      verifiedAt: new Date('2026-09-21T00:00:00.000Z'),
    });
    createdUserIds.push(result.id);
    return { ...result, email };
  }

  it('seeds an account idempotently without replacing credentials or profile data', async () => {
    const account = await seedPlayer();
    const repeated = await repository.seedAccount({
      email: account.email,
      passwordHash: 'replacement-hash-must-not-be-written',
      displayName: 'Replacement Name',
      role: 'admin',
      verifiedAt: new Date('2026-09-22T00:00:00.000Z'),
    });

    expect(account.created).toBe(true);
    expect(repeated).toEqual({ id: account.id, role: 'player', created: false });
    await expect(repository.findAccountByEmail(account.email)).resolves.toMatchObject({
      passwordHash: 'original-test-hash',
      displayName: 'Repository Player',
      role: 'player',
    });
  });

  it('creates, resolves, touches, and idempotently revokes opaque sessions', async () => {
    const account = await seedPlayer();
    const now = new Date('2026-09-21T00:00:00.000Z');
    const tokenHash = hashOpaqueToken(`session-${randomUUID()}`);
    const sessionId = await repository.createSession({
      userId: account.id,
      tokenHash,
      now,
      idleExpiresAt: new Date('2026-10-21T00:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-12-20T00:00:00.000Z'),
    });

    await expect(repository.findSessionByTokenHash(tokenHash)).resolves.toMatchObject({
      sessionId,
      id: account.id,
      revokedAt: null,
    });
    await expect(repository.findSessionById(sessionId)).resolves.toMatchObject({
      sessionId,
      id: account.id,
    });

    const activityAt = new Date('2026-09-22T00:00:00.000Z');
    const nextIdleExpiry = new Date('2026-10-22T00:00:00.000Z');
    await repository.touchSession(sessionId, activityAt, nextIdleExpiry);
    await repository.revokeSessionByTokenHash(tokenHash, activityAt, 'logout');
    await repository.revokeSessionByTokenHash(tokenHash, activityAt, 'logout');

    await expect(repository.findSessionById(sessionId)).resolves.toMatchObject({
      lastSeenAt: activityAt,
      idleExpiresAt: nextIdleExpiry,
      revokedAt: activityAt,
    });
  });

  it('consumes a verification token exactly once under concurrency', async () => {
    const account = await seedPlayer();
    const now = new Date('2026-09-21T00:00:00.000Z');
    const tokenHash = hashOpaqueToken(`verification-${randomUUID()}`);
    await repository.issueEmailToken({
      userId: account.id,
      purpose: 'email_verification',
      tokenHash,
      now,
      expiresAt: new Date('2026-09-22T00:00:00.000Z'),
    });

    const results = await Promise.all([
      repository.consumeVerificationToken(tokenHash, now),
      repository.consumeVerificationToken(tokenHash, now),
    ]);

    expect(results.sort()).toEqual([false, true]);
    await expect(repository.findAccountByEmail(account.email)).resolves.toMatchObject({
      emailVerifiedAt: now,
    });
  });

  it('atomically resets a password, revokes sessions, and rejects token replay', async () => {
    const account = await seedPlayer();
    const now = new Date('2026-09-21T00:00:00.000Z');
    const sessionTokenHash = hashOpaqueToken(`session-${randomUUID()}`);
    const sessionId = await repository.createSession({
      userId: account.id,
      tokenHash: sessionTokenHash,
      now,
      idleExpiresAt: new Date('2026-10-21T00:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-12-20T00:00:00.000Z'),
    });
    const resetTokenHash = hashOpaqueToken(`reset-${randomUUID()}`);
    await repository.issueEmailToken({
      userId: account.id,
      purpose: 'password_reset',
      tokenHash: resetTokenHash,
      now,
      expiresAt: new Date('2026-09-22T00:00:00.000Z'),
    });

    await expect(
      repository.consumePasswordResetToken(resetTokenHash, 'new-test-hash', now),
    ).resolves.toBe(true);
    await expect(
      repository.consumePasswordResetToken(resetTokenHash, 'replay-hash', now),
    ).resolves.toBe(false);
    await expect(repository.findAccountByEmail(account.email)).resolves.toMatchObject({
      passwordHash: 'new-test-hash',
    });
    await expect(repository.findSessionById(sessionId)).resolves.toMatchObject({
      revokedAt: now,
    });
  });
});
