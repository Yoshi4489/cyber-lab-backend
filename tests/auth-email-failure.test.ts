import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AccountRecord, AuthRepository } from '../src/services/auth-repository.js';
import { AuthenticationService } from '../src/services/authentication.js';
import { testConfig } from './helpers.js';

function repository() {
  return {
    findAccountByEmail: vi.fn<AuthRepository['findAccountByEmail']>().mockResolvedValue(null),
    seedAccount: vi.fn<AuthRepository['seedAccount']>(),
    createSession: vi.fn<AuthRepository['createSession']>(),
    findSessionByTokenHash: vi.fn<AuthRepository['findSessionByTokenHash']>(),
    findSessionById: vi.fn<AuthRepository['findSessionById']>(),
    touchSession: vi.fn<AuthRepository['touchSession']>(),
    revokeSessionByTokenHash: vi.fn<AuthRepository['revokeSessionByTokenHash']>(),
    revokeSessionsForUser: vi.fn<AuthRepository['revokeSessionsForUser']>(),
    issueEmailToken: vi.fn<AuthRepository['issueEmailToken']>().mockResolvedValue(undefined),
    consumeVerificationToken: vi.fn<AuthRepository['consumeVerificationToken']>(),
    consumePasswordResetToken: vi.fn<AuthRepository['consumePasswordResetToken']>(),
    appendAuditEvent: vi.fn<AuthRepository['appendAuditEvent']>().mockResolvedValue(undefined),
  } satisfies AuthRepository;
}

const account: AccountRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'player@example.test', passwordHash: 'test-only-hash', displayName: 'Player',
  role: 'player', status: 'active', emailVerifiedAt: null,
};

describe('auth email failure acknowledgements', () => {
  it.each([
    ['/v1/auth/verification/request', 'email_verification', 'sendEmailVerification'],
    ['/v1/auth/password-reset/request', 'password_reset', 'sendPasswordReset'],
  ] as const)('preserves a generic HTTP response for %s and audits safe metadata', async (url, purpose, method) => {
    const repo = repository();
    const mailer = {
      sendEmailVerification: vi.fn().mockRejectedValue(new Error('private-token provider-password recipient')),
      sendPasswordReset: vi.fn().mockRejectedValue(new Error('private-token provider-password recipient')),
    };
    const authentication = await AuthenticationService.create({
      repository: repo,
      passwordHasher: { hash: async () => 'dummy-hash', verify: async () => false },
      mailer,
    });
    const app = await buildApp(testConfig, { authentication });
    try {
      const request = { method: 'POST' as const, url,
        headers: { authorization: `Bearer ${testConfig.BFF_AUTH_SECRET}` },
        payload: { email: account.email } };
      const unknown = await app.inject(request);
      repo.findAccountByEmail.mockResolvedValue(account);
      const failedDelivery = await app.inject(request);
      expect(unknown.statusCode).toBe(202);
      expect(failedDelivery.statusCode).toBe(202);
      expect(unknown.json()).toEqual({ accepted: true });
      expect(failedDelivery.json()).toEqual(unknown.json());
      expect(mailer[method]).toHaveBeenCalledOnce();
      expect(repo.appendAuditEvent).toHaveBeenCalledExactlyOnceWith({
        eventType: 'auth.email.delivery_failed', targetUserId: account.id,
        details: { purpose }, createdAt: expect.any(Date),
      });
      const issued = repo.issueEmailToken.mock.calls[0]?.[0];
      expect(issued?.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(repo.appendAuditEvent.mock.calls)).not.toContain('private-token');
    } finally { await app.close(); }
  });

  it('still surfaces storage failures instead of claiming the token was issued', async () => {
    const repo = repository();
    repo.findAccountByEmail.mockResolvedValue(account);
    repo.issueEmailToken.mockRejectedValue(new Error('Storage unavailable'));
    const mailer = { sendEmailVerification: vi.fn(), sendPasswordReset: vi.fn() };
    const service = await AuthenticationService.create({
      repository: repo, passwordHasher: { hash: async () => 'dummy', verify: async () => false }, mailer,
    });
    await expect(service.requestPasswordReset(account.email)).rejects.toThrow('Storage unavailable');
    expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
  });
});
