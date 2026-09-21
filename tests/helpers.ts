import { SignJWT } from 'jose';
import type { Config } from '../src/config.js';

/** A complete, valid config so tests never depend on a `.env` file. */
export const testConfig: Config = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 4000,
  FRONTEND_ORIGIN: 'http://localhost:3000',
  BFF_AUTH_SECRET: 'test-bff-secret-at-least-thirty-two-characters',
  BACKEND_SERVICE_TOKEN_SECRET: 'test-secret-at-least-thirty-two-characters',
  SERVICE_TOKEN_ISSUER: 'cyber-range-frontend',
  SERVICE_TOKEN_AUDIENCE: 'cyber-range-backend',
  SIGNUPS_OPEN: false,
  AUTH_RATE_LIMIT_MAX: 10,
  AUTH_RATE_LIMIT_WINDOW: '1 minute',
  LOCAL_MAIL_DIRECTORY: '.local-mail',
};

export function signToken(scope: string): Promise<string> {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('player-1')
    .setIssuer(testConfig.SERVICE_TOKEN_ISSUER)
    .setAudience(testConfig.SERVICE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(testConfig.BACKEND_SERVICE_TOKEN_SECRET));
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
