import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPasswordHasher } from '../src/auth/password.js';
import { buildApp } from '../src/app.js';
import { DrizzleAuthRepository } from '../src/db/auth-repository.js';
import { createDatabase, type DatabaseClient } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { MOCK_CHALLENGES } from '../src/mocks/challenges.js';
import { AuthenticationService } from '../src/services/authentication.js';
import type { AuthMail, AuthMailer } from '../src/services/mailer.js';
import { signToken, testConfig } from './helpers.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const passwordHasher = createPasswordHasher({
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

describeDatabase('BFF authentication routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseClient;
  let userId: string;
  let email: string;
  const password = 'route-test-password-long-enough';
  const bffHeaders = {
    authorization: `Bearer ${testConfig.BFF_AUTH_SECRET}`,
  };

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    database = createDatabase(testDatabaseUrl);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    const repository = new DrizzleAuthRepository(database.db);
    email = `routes-${randomUUID()}@example.test`;
    const seeded = await repository.seedAccount({
      email,
      passwordHash: await passwordHasher.hash(password),
      displayName: 'Route Player',
      role: 'player',
      verifiedAt: new Date(),
    });
    userId = seeded.id;
    const authentication = await AuthenticationService.create({
      repository,
      passwordHasher,
      mailer: new CapturingMailer(),
    });
    app = await buildApp(testConfig, { database, authentication });
  }, 30_000);

  afterAll(async () => {
    if (database && userId) {
      await database.db.delete(users).where(eq(users.id, userId));
    }
    await app?.close();
  });

  it('authenticates the BFF before validating credentials', async () => {
    const missingCredential = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'invalid', password: 'short' },
    });
    expect(missingCredential.statusCode).toBe(401);

    const userServiceToken = await signToken('submissions:write');
    const wrongCredentialFamily = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { authorization: `Bearer ${userServiceToken}` },
      payload: { email, password },
    });
    expect(wrongCredentialFamily.statusCode).toBe(401);
  });

  it('logs in, resolves the trusted identity, and revokes on repeated logout', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: bffHeaders,
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.body).not.toContain(password);
    expect(login.body).not.toContain('passwordHash');
    const loginBody = login.json();
    expect(loginBody).toMatchObject({
      user: { id: userId, email, role: 'player' },
      allowedScopes: ['submissions:write', 'instances:read', 'instances:write'],
    });

    const userSelection = await app.inject({
      method: 'POST',
      url: '/v1/auth/session',
      headers: bffHeaders,
      payload: { sessionToken: loginBody.sessionToken, userId: randomUUID() },
    });
    expect(userSelection.statusCode).toBe(400);

    const resolved = await app.inject({
      method: 'POST',
      url: '/v1/auth/session',
      headers: bffHeaders,
      payload: { sessionToken: loginBody.sessionToken },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      sessionId: loginBody.sessionId,
      user: { id: userId },
    });

    const serviceToken = await signToken('submissions:write', {
      subject: userId,
      sessionId: loginBody.sessionId,
    });
    const submission = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: {
        challengeId: MOCK_CHALLENGES[0]?.id,
        flag: 'not-a-real-flag',
      },
    });
    expect(submission.statusCode).toBe(200);

    const foreignSubjectToken = await signToken('submissions:write', {
      subject: randomUUID(),
      sessionId: loginBody.sessionId,
    });
    const foreignSubject = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${foreignSubjectToken}` },
      payload: {
        challengeId: MOCK_CHALLENGES[0]?.id,
        flag: 'not-a-real-flag',
      },
    });
    expect(foreignSubject.statusCode).toBe(401);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const logout = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: bffHeaders,
        payload: { sessionToken: loginBody.sessionToken },
      });
      expect(logout.statusCode).toBe(204);
    }

    const revoked = await app.inject({
      method: 'POST',
      url: '/v1/auth/session',
      headers: bffHeaders,
      payload: { sessionToken: loginBody.sessionToken },
    });
    expect(revoked.statusCode).toBe(401);

    const revokedServiceToken = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: {
        challengeId: MOCK_CHALLENGES[0]?.id,
        flag: 'not-a-real-flag',
      },
    });
    expect(revokedServiceToken.statusCode).toBe(401);
  });

  it('returns generic recovery acknowledgements and keeps signup closed', async () => {
    const unknownReset = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      headers: bffHeaders,
      payload: { email: 'missing@example.test' },
    });
    const knownReset = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      headers: bffHeaders,
      payload: { email },
    });
    expect(unknownReset.statusCode).toBe(202);
    expect(knownReset.statusCode).toBe(202);
    expect(unknownReset.json()).toEqual(knownReset.json());

    const signup = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      headers: bffHeaders,
      payload: {
        email: 'new-player@example.test',
        password: 'signup-password-long-enough',
        displayName: 'New Player',
      },
    });
    expect(signup.statusCode).toBe(403);
    expect(signup.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('publishes the auth contract without publishing either server secret', async () => {
    const response = await app.inject('/v1/openapi.json');
    const document = response.json();

    expect(document.components.securitySchemes.bffAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
    });
    expect(document.paths['/v1/auth/login'].post.security).toEqual([{ bffAuth: [] }]);
    expect(document.paths['/v1/auth/signup'].post.responses).toHaveProperty('403');
    expect(response.body).not.toContain(testConfig.BFF_AUTH_SECRET);
    expect(response.body).not.toContain(testConfig.BACKEND_SERVICE_TOKEN_SECRET);
  });
});
