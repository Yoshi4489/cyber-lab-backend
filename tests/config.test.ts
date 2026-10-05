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
  it('keeps local mail delivery as the default', () => {
    expect(loadConfig(validEnvironment).MAIL_PROVIDER).toBe('local');
  });

  it('requires complete credentials for Gmail delivery', () => {
    expect(() => loadConfig({ ...validEnvironment, MAIL_PROVIDER: 'gmail' })).toThrow('requires SMTP_USER');
    expect(loadConfig({
      ...validEnvironment, MAIL_PROVIDER: 'gmail', SMTP_USER: 'sender@gmail.com', SMTP_APP_PASSWORD: 'test-only',
    }).MAIL_PROVIDER).toBe('gmail');
  });

  it('refuses Gmail demo delivery in production', () => {
    expect(() => loadConfig({
      ...validEnvironment, NODE_ENV: 'production', MAIL_PROVIDER: 'gmail',
      SMTP_USER: 'sender@gmail.com', SMTP_APP_PASSWORD: 'test-only',
    })).toThrow('disabled in production');
  });

  it('rejects unsafe email origins and sender header injection', () => {
    const gmail = { ...validEnvironment, MAIL_PROVIDER: 'gmail', SMTP_USER: 'sender@gmail.com', SMTP_APP_PASSWORD: 'test-only' };
    expect(() => loadConfig({ ...gmail, FRONTEND_ORIGIN: 'javascript:alert(1)' })).toThrow('HTTP(S)');
    expect(() => loadConfig({ ...gmail, FRONTEND_ORIGIN: 'https://user:password@example.test' })).toThrow('without credentials');
    expect(() => loadConfig({ ...gmail, EMAIL_SENDER_NAME: 'Sender\r\nBcc: attacker@example.test' })).toThrow();
  });
  it('loads with signup closed and bounded auth rate limits', () => {
    expect(loadConfig(validEnvironment)).toMatchObject({
      SIGNUPS_OPEN: false,
      AUTH_RATE_LIMIT_MAX: 10,
      AUTH_RATE_LIMIT_WINDOW: '1 minute',
      SUBMISSION_RATE_LIMIT_MAX: 20,
      SUBMISSION_RATE_LIMIT_WINDOW_MS: 60_000,
      INSTANCE_RATE_LIMIT_MAX: 5,
      INSTANCE_RATE_LIMIT_WINDOW_MS: 60_000,
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
