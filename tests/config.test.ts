import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '4000',
  FRONTEND_ORIGIN: 'http://localhost:3000',
  BFF_AUTH_SECRET: 'config-bff-secret-at-least-thirty-two-characters',
  BACKEND_SERVICE_TOKEN_SECRET: 'config-jwt-secret-at-least-thirty-two-characters',
  INSTANCE_FLAG_SECRET: 'config-flag-secret-at-least-thirty-two-characters',
  SERVICE_TOKEN_ISSUER: 'cyber-range-frontend',
  SERVICE_TOKEN_AUDIENCE: 'cyber-range-backend',
  SIGNUPS_OPEN: 'false',
};

describe('authentication configuration', () => {
  it('loads with signup closed and bounded auth rate limits', () => {
    expect(loadConfig(validEnvironment)).toMatchObject({
      SIGNUPS_OPEN: false,
      AUTH_RATE_LIMIT_MAX: 10,
      AUTH_RATE_LIMIT_WINDOW: '1 minute',
      SUBMISSION_RATE_LIMIT_MAX: 20,
      SUBMISSION_RATE_LIMIT_WINDOW_MS: 60_000,
    });
  });

  it('rejects reuse of the service signing secret as the BFF credential', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        BFF_AUTH_SECRET: validEnvironment.BACKEND_SERVICE_TOKEN_SECRET,
      }),
    ).toThrow('must be different');
  });

  it('rejects reuse of an authentication secret for instance flags', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        INSTANCE_FLAG_SECRET: validEnvironment.BFF_AUTH_SECRET,
      }),
    ).toThrow('must be different');
  });

  it('does not accept a configuration that opens public signup', () => {
    expect(() => loadConfig({ ...validEnvironment, SIGNUPS_OPEN: 'true' })).toThrow();
  });
});
