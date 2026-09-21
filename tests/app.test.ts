import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const config: Config = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 4000,
  FRONTEND_ORIGIN: 'http://localhost:3000',
  BFF_AUTH_SECRET: 'test-bff-secret-at-least-thirty-two-characters',
  BACKEND_SERVICE_TOKEN_SECRET: 'test-secret-at-least-thirty-two-characters',
  INSTANCE_FLAG_SECRET: 'test-instance-flag-secret-at-least-thirty-two-characters',
  SERVICE_TOKEN_ISSUER: 'cyber-range-frontend',
  SERVICE_TOKEN_AUDIENCE: 'cyber-range-backend',
  SIGNUPS_OPEN: false,
  AUTH_RATE_LIMIT_MAX: 10,
  AUTH_RATE_LIMIT_WINDOW: '1 minute',
  SUBMISSION_RATE_LIMIT_MAX: 20,
  SUBMISSION_RATE_LIMIT_WINDOW_MS: 60_000,
  LOCAL_MAIL_DIRECTORY: '.local-mail',
};

async function token(scope: string) {
  return new SignJWT({ scope, sid: '00000000-0000-4000-8000-000000000002' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('player-1')
    .setIssuer(config.SERVICE_TOKEN_ISSUER)
    .setAudience(config.SERVICE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(config.BACKEND_SERVICE_TOKEN_SECRET));
}

const dependencies = {
  sessionAuthorizer: {
    validateServiceSession: async () => ({
      allowedScopes: ['instances:read', 'instances:write'],
    }),
  },
};

describe('API scaffold', () => {
  it('serves health and version metadata', async () => {
    const app = await buildApp(config, dependencies);
    try {
      expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
      expect((await app.inject('/v1/meta')).json()).toEqual({ name: 'cyber-range-backend', version: 'v1' });
    } finally { await app.close(); }
  });

  it('gates unfinished lifecycle routes behind a verified token', async () => {
    const app = await buildApp(config, dependencies);
    try {
      const path = '/v1/instances/00000000-0000-4000-8000-000000000001';
      expect((await app.inject(path)).statusCode).toBe(401);
      expect((await app.inject({ url: path, headers: { authorization: `Bearer ${await token('instances:write')}` } })).statusCode).toBe(401);
      expect((await app.inject({ url: path, headers: { authorization: `Bearer ${await token('instances:read')}` } })).statusCode).toBe(501);
    } finally { await app.close(); }
  });
});
