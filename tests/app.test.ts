import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const config: Config = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 4000,
  FRONTEND_ORIGIN: 'http://localhost:3000',
  BACKEND_SERVICE_TOKEN_SECRET: 'test-secret-at-least-thirty-two-characters',
  SERVICE_TOKEN_ISSUER: 'cyber-range-frontend',
  SERVICE_TOKEN_AUDIENCE: 'cyber-range-backend',
};

async function token(scope: string) {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('player-1')
    .setIssuer(config.SERVICE_TOKEN_ISSUER)
    .setAudience(config.SERVICE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(config.BACKEND_SERVICE_TOKEN_SECRET));
}

describe('API scaffold', () => {
  it('serves health and version metadata', async () => {
    const app = await buildApp(config);
    try {
      expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
      expect((await app.inject('/v1/meta')).json()).toEqual({ name: 'cyber-range-backend', version: 'v1' });
    } finally { await app.close(); }
  });

  it('gates unfinished lifecycle routes behind a verified token', async () => {
    const app = await buildApp(config);
    try {
      const path = '/v1/instances/00000000-0000-4000-8000-000000000001';
      expect((await app.inject(path)).statusCode).toBe(401);
      expect((await app.inject({ url: path, headers: { authorization: `Bearer ${await token('instances:write')}` } })).statusCode).toBe(401);
      expect((await app.inject({ url: path, headers: { authorization: `Bearer ${await token('instances:read')}` } })).statusCode).toBe(501);
    } finally { await app.close(); }
  });
});
