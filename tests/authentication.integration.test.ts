import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPasswordHasher } from '../src/auth/password.js';
import { DrizzleAuthRepository } from '../src/db/auth-repository.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { AuthenticationService } from '../src/services/authentication.js';
import type { AuthMail, AuthMailer } from '../src/services/mailer.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const testPasswordHasher = createPasswordHasher({
  memoryCost: 4 * 1024,
  timeCost: 1,
  parallelism: 1,
  hashLength: 32,
});

class CapturingMailer implements AuthMailer {
  readonly verifications: AuthMail[] = [];
  readonly passwordResets: AuthMail[] = [];

  async sendEmailVerification(mail: AuthMail): Promise<void> {
    this.verifications.push(mail);
  }

  async sendPasswordReset(mail: AuthMail): Promise<void> {
    this.passwordResets.push(mail);
  }
}

describeDatabase('authentication service', () => {
  let database: DatabaseClient;
  let repository: DrizzleAuthRepository;
  let now: Date;
  let mailer: CapturingMailer;
  let service: AuthenticationService;
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

  async function resetService() {
    now = new Date('2026-09-21T00:00:00.000Z');
    mailer = new CapturingMailer();
    service = await AuthenticationService.create({
      repository,
      passwordHasher: testPasswordHasher,
      mailer,
      now: () => now,
    });
  }

  async function seedAccount(input: {
    password?: string;
    role?: 'player' | 'admin';
    verified?: boolean;
  } = {}) {
    const email = `service-${randomUUID()}@example.test`;
    const password = input.password ?? 'test-password-long-enough';
    const result = await repository.seedAccount({
      email,
      passwordHash: await testPasswordHasher.hash(password),
      displayName: 'Service Player',
      role: input.role ?? 'player',
      verifiedAt: input.verified === false ? null : now,
    });
    createdUserIds.push(result.id);
    return { ...result, email, password };
  }

  it('creates fresh 30-day/90-day sessions and rejects unknown credentials', async () => {
    await resetService();
    const account = await seedAccount();

    const login = await service.login(account.email.toUpperCase(), account.password);
    expect(login.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(login.user).toMatchObject({ id: account.id, role: 'player' });
    expect(login.allowedScopes).toEqual([
      'submissions:write',
      'instances:read',
      'instances:write',
    ]);
    expect(login.idleExpiresAt).toEqual(new Date('2026-10-21T00:00:00.000Z'));
    expect(login.absoluteExpiresAt).toEqual(new Date('2026-12-20T00:00:00.000Z'));

    await expect(service.login('missing@example.test', account.password)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password',
    });
    await expect(service.login(account.email, 'wrong-password')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password',
    });
  });

  it('resolves ownership, refreshes inactivity, and observes account disablement', async () => {
    await resetService();
    const account = await seedAccount({ role: 'admin' });
    const login = await service.login(account.email, account.password);

    now = new Date('2026-09-22T00:00:00.000Z');
    await expect(service.resolveSession(login.sessionToken)).resolves.toMatchObject({
      sessionId: login.sessionId,
      idleExpiresAt: new Date('2026-10-22T00:00:00.000Z'),
      allowedScopes: expect.arrayContaining(['admin:write']),
    });
    await expect(
      service.validateServiceSession(randomUUID(), login.sessionId),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    await database.db
      .update(users)
      .set({ status: 'disabled' })
      .where(eq(users.id, account.id));
    await expect(
      service.validateServiceSession(account.id, login.sessionId),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('treats logout as idempotent and rejects the revoked session', async () => {
    await resetService();
    const account = await seedAccount();
    const login = await service.login(account.email, account.password);

    await service.logout(login.sessionToken);
    await service.logout(login.sessionToken);
    await expect(service.resolveSession(login.sessionToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects sessions at the inactivity and absolute expiry boundaries', async () => {
    await resetService();
    const account = await seedAccount();
    const idleLogin = await service.login(account.email, account.password);

    now = idleLogin.idleExpiresAt;
    await expect(service.resolveSession(idleLogin.sessionToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    now = new Date('2026-09-21T00:00:00.000Z');
    const absoluteLogin = await service.login(account.email, account.password);
    now = absoluteLogin.absoluteExpiresAt;
    await expect(service.resolveSession(absoluteLogin.sessionToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('keeps verification requests generic and rejects token replay', async () => {
    await resetService();
    const account = await seedAccount({ verified: false });

    await service.requestEmailVerification('missing@example.test');
    expect(mailer.verifications).toHaveLength(0);
    await service.requestEmailVerification(account.email);
    expect(mailer.verifications).toHaveLength(1);

    const token = mailer.verifications[0]?.token;
    if (!token) throw new Error('Expected a captured verification token');
    await service.confirmEmailVerification(token);
    await expect(service.confirmEmailVerification(token)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(repository.findAccountByEmail(account.email)).resolves.toMatchObject({
      emailVerifiedAt: now,
    });
  });

  it('resets the password and revokes every existing session', async () => {
    await resetService();
    const account = await seedAccount();
    const login = await service.login(account.email, account.password);

    await service.requestPasswordReset(account.email);
    const token = mailer.passwordResets[0]?.token;
    if (!token) throw new Error('Expected a captured password reset token');
    await service.confirmPasswordReset(token, 'new-test-password-long-enough');

    await expect(service.resolveSession(login.sessionToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(service.login(account.email, account.password)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(
      service.login(account.email, 'new-test-password-long-enough'),
    ).resolves.toMatchObject({ user: { id: account.id } });
    await expect(
      service.confirmPasswordReset(token, 'another-new-test-password'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
