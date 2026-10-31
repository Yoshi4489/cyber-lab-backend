import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { BFF_CLIENT_IP_HEADER } from '../src/auth/bff-rate-keys.js';
import type { AuthRepository } from '../src/services/auth-repository.js';
import { AuthenticationService } from '../src/services/authentication.js';
import { signToken, testConfig } from './helpers.js';

const config = { ...testConfig, AUTH_RATE_LIMIT_MAX: 3, SESSION_RATE_LIMIT_MAX: 4 };
const bff = { authorization: `Bearer ${testConfig.BFF_AUTH_SECRET}` };
const login = { email: 'player@example.test', password: 'not-the-password-value' };

async function testApp() {
  const repository = {
    findAccountByEmail: vi.fn().mockResolvedValue(null),
    findSessionByTokenHash: vi.fn().mockResolvedValue(null),
    revokeSessionByTokenHash: vi.fn().mockResolvedValue(undefined),
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthRepository;
  const authentication = await AuthenticationService.create({
    repository,
    passwordHasher: { hash: async () => 'dummy-hash', verify: async () => false },
    mailer: { sendEmailVerification: vi.fn(), sendPasswordReset: vi.fn() },
  });
  return buildApp(config, { authentication });
}

async function codes(count: number, send: () => Promise<{ statusCode: number }>) {
  const results: number[] = [];
  for (let index = 0; index < count; index += 1) results.push((await send()).statusCode);
  return results;
}

describe('BFF auth rate-limit keys', () => {
  it('limits login per forwarded learner address, not per BFF address', async () => {
    const app = await testApp();
    try {
      const from = (ip: string) => () => app.inject({
        method: 'POST', url: '/v1/auth/login', headers: { ...bff, [BFF_CLIENT_IP_HEADER]: ip }, payload: login,
      });
      expect(await codes(4, from('203.0.113.10'))).toEqual([401, 401, 401, 429]);
      expect(await codes(3, from('203.0.113.11'))).toEqual([401, 401, 401]);
      expect(await codes(1, from('2001:db8::1'))).toEqual([401]);
    } finally { await app.close(); }
  });

  it('applies the same per-address key to email verification and reset requests', async () => {
    const app = await testApp();
    try {
      const request = (url: string) => () => app.inject({
        method: 'POST', url, headers: { ...bff, [BFF_CLIENT_IP_HEADER]: '198.51.100.7' }, payload: { email: login.email },
      });
      expect(await codes(4, request('/v1/auth/password-reset/request'))).toEqual([202, 202, 202, 429]);
    } finally { await app.close(); }
  });

  it('does not let requests without the BFF credential consume or choose a learner budget', async () => {
    const app = await testApp();
    try {
      const forged = () => app.inject({
        method: 'POST', url: '/v1/auth/login', headers: { [BFF_CLIENT_IP_HEADER]: '203.0.113.20' }, payload: login,
      });
      expect(await codes(5, forged)).toEqual([401, 401, 401, 401, 401]);
      const real = await app.inject({
        method: 'POST', url: '/v1/auth/login', headers: { ...bff, [BFF_CLIENT_IP_HEADER]: '203.0.113.20' }, payload: login,
      });
      expect(real.statusCode).toBe(401);
      expect(real.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    } finally { await app.close(); }
  });

  it('falls back to the shared BFF address when the forwarded value is missing or malformed', async () => {
    const app = await testApp();
    try {
      const send = (value?: string) => () => app.inject({
        method: 'POST', url: '/v1/auth/login', payload: login,
        headers: value === undefined ? bff : { ...bff, [BFF_CLIENT_IP_HEADER]: value },
      });
      const results = [
        ...await codes(1, send()), ...await codes(1, send('not-an-ip')),
        ...await codes(1, send('203.0.113.30, 10.0.0.1')), ...await codes(1, send()),
      ];
      expect(results).toEqual([401, 401, 401, 429]);
    } finally { await app.close(); }
  });

  it('limits session resolution and logout per session token', async () => {
    const app = await testApp();
    try {
      const session = (token: string) => () => app.inject({
        method: 'POST', url: '/v1/auth/session', headers: { ...bff, [BFF_CLIENT_IP_HEADER]: '203.0.113.40' },
        payload: { sessionToken: token.repeat(43) },
      });
      expect(await codes(5, session('A'))).toEqual([401, 401, 401, 401, 429]);
      expect(await codes(4, session('B'))).toEqual([401, 401, 401, 401]);
      const logout = (token: string) => () => app.inject({
        method: 'POST', url: '/v1/auth/logout', headers: bff, payload: { sessionToken: token.repeat(43) },
      });
      expect(await codes(5, logout('C'))).toEqual([204, 204, 204, 204, 429]);
      expect((await logout('D')()).statusCode).toBe(204);
    } finally { await app.close(); }
  });
});

describe('general API rate-limit key', () => {
  const generalConfig = { ...testConfig, GENERAL_RATE_LIMIT_MAX: 3 };
  const get = (app: Awaited<ReturnType<typeof buildApp>>, authorization?: string) => () => app.inject({
    method: 'GET', url: '/v1/meta', ...(authorization ? { headers: { authorization } } : {}),
  });

  it('gives each service-token user their own budget behind one BFF address', async () => {
    const app = await buildApp(generalConfig);
    try {
      const a = `Bearer ${await signToken('profile:read', { subject: 'learner-a' })}`;
      const b = `Bearer ${await signToken('instances:read', { subject: 'learner-b' })}`;
      expect(await codes(4, get(app, a))).toEqual([200, 200, 200, 429]);
      expect(await codes(3, get(app, b))).toEqual([200, 200, 200]);
      // A fresh token for the same subject shares that subject's budget.
      const again = `Bearer ${await signToken('submissions:write', { subject: 'learner-a' })}`;
      expect((await get(app, again)()).statusCode).toBe(429);
      expect(await codes(3, get(app))).toEqual([200, 200, 200]);
    } finally { await app.close(); }
  });

  it('counts forged or invalid tokens against the connecting address', async () => {
    const app = await buildApp(generalConfig);
    try {
      const forged = (subject: string) => `Bearer ${[
        Buffer.from('{"alg":"HS256"}').toString('base64url'),
        Buffer.from(JSON.stringify({ sub: subject })).toString('base64url'),
        'not-a-signature',
      ].join('.')}`;
      const results = [
        ...await codes(1, get(app, forged('x'))), ...await codes(1, get(app, forged('y'))),
        ...await codes(1, get(app, 'Bearer garbage')), ...await codes(1, get(app)),
      ];
      expect(results).toEqual([200, 200, 200, 429]);
    } finally { await app.close(); }
  });
});
