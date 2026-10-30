import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { HmacInstanceFlagService } from '../src/services/instance-flags.js';
import { SubmissionService } from '../src/services/submissions.js';
import { signToken, testAppDependencies, testConfig } from './helpers.js';

const environment = {
  NODE_ENV: 'test',
  FRONTEND_ORIGIN: 'http://localhost:3000',
  BFF_AUTH_SECRET: 'local-dev-bff-secret-at-least-thirty-two-characters',
  BACKEND_SERVICE_TOKEN_SECRET: 'local-dev-jwt-secret-at-least-thirty-two-characters',
  INSTANCE_FLAG_SECRET: 'local-dev-flag-secret-at-least-thirty-two-characters',
  SERVICE_TOKEN_ISSUER: 'cyber-range-frontend',
  SERVICE_TOKEN_AUDIENCE: 'cyber-range-backend',
};
const submissions = new SubmissionService(
  { recordSubmission: async ({ correct }) => ({ submissionId: randomUUID(), correct, pointsAwarded: 0, firstSolve: false }) },
  { findOwnedInstance: async () => ({ challengeId: '11111111-1111-4111-8111-111111111111' }) },
  new HmacInstanceFlagService(testConfig.INSTANCE_FLAG_SECRET),
);

async function statuses(count: number, request: () => Promise<number>) {
  const results: number[] = [];
  for (let index = 0; index < count; index += 1) results.push(await request());
  return results;
}

describe('LOCAL_DEV_TEST rate-limit switch', () => {
  it('defaults off, accepts true outside production and rejects other values', () => {
    expect(loadConfig(environment).LOCAL_DEV_TEST).toBe(false);
    expect(loadConfig({ ...environment, LOCAL_DEV_TEST: 'true' }).LOCAL_DEV_TEST).toBe(true);
    expect(loadConfig({ ...environment, NODE_ENV: 'development', LOCAL_DEV_TEST: 'true' }).LOCAL_DEV_TEST).toBe(true);
    expect(() => loadConfig({ ...environment, LOCAL_DEV_TEST: 'yes' })).toThrow();
  });

  it('is rejected in production whenever it is set', () => {
    const production = {
      ...environment, NODE_ENV: 'production', MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test_only', EMAIL_FROM: 'labs@example.test', FRONTEND_ORIGIN: 'https://learn.example.test',
    };
    expect(loadConfig(production).LOCAL_DEV_TEST).toBe(false);
    for (const LOCAL_DEV_TEST of ['true', 'false']) {
      expect(() => loadConfig({ ...production, LOCAL_DEV_TEST })).toThrow('LOCAL_DEV_TEST is disabled in production');
    }
  });

  it.each([false, true])('per-IP limiter with LOCAL_DEV_TEST=%s', async (localDevTest) => {
    const app = await buildApp({ ...testConfig, LOCAL_DEV_TEST: localDevTest });
    try {
      const results = await statuses(101, async () => (await app.inject('/v1/meta')).statusCode);
      expect(results.slice(0, 100).every((status) => status === 200)).toBe(true);
      expect(results[100]).toBe(localDevTest ? 200 : 429);
    } finally { await app.close(); }
  });

  it.each([false, true])('per-user submission limiter with LOCAL_DEV_TEST=%s', async (localDevTest) => {
    const app = await buildApp({ ...testConfig, LOCAL_DEV_TEST: localDevTest }, { ...testAppDependencies, submissions });
    try {
      const token = await signToken('submissions:write');
      const payload = {
        challengeId: '11111111-1111-4111-8111-111111111111',
        instanceId: '00000000-0000-4000-8000-000000000003',
        flag: 'CTF{wrong}',
      };
      const results = await statuses(testConfig.SUBMISSION_RATE_LIMIT_MAX + 1, async () => (await app.inject({
        method: 'POST', url: '/v1/submissions', headers: { authorization: `Bearer ${token}` }, payload,
      })).statusCode);
      expect(results.slice(0, -1).every((status) => status === 200)).toBe(true);
      expect(results.at(-1)).toBe(localDevTest ? 200 : 429);
    } finally { await app.close(); }
  });
});
