import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { UUID_PATTERN, signToken, testAppDependencies, testConfig } from './helpers.js';

describe('error envelope', () => {
  it('answers an unknown route with a code, a message and a correlation id', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject('/does-not-exist');
      const body = response.json<{ code: string; message: string; correlationId: string }>();

      expect(response.statusCode).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
      expect(body.message).toBeTypeOf('string');
      expect(body.correlationId).toMatch(UUID_PATTERN);
      expect(response.headers['x-request-id']).toBe(body.correlationId);
    } finally {
      await app.close();
    }
  });

  it('uses the same envelope for an unauthenticated lifecycle call', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject('/v1/instances/00000000-0000-4000-8000-000000000001');
      const body = response.json<{ code: string; correlationId: string }>();

      expect(response.statusCode).toBe(401);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.correlationId).toMatch(UUID_PATTERN);
    } finally {
      await app.close();
    }
  });

  it('rejects a malformed body without leaking framework internals', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/instances',
        headers: {
          authorization: `Bearer ${await signToken('instances:write')}`,
          'content-type': 'application/json',
        },
        payload: '{',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('INVALID_REQUEST');
      // No FST_ERR_* code, no stack frame, no file path.
      expect(response.body).not.toContain('FST_ERR');
      expect(response.body).not.toContain('at ');
    } finally {
      await app.close();
    }
  });

  it('rejects a body that fails validation', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/instances',
        headers: { authorization: `Bearer ${await signToken('instances:write')}` },
        payload: { challengeId: 'not-a-uuid' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('INVALID_REQUEST');
    } finally {
      await app.close();
    }
  });
});

describe('correlation ids', () => {
  it('reuses a well-formed inbound request id so one id spans both services', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const supplied = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
      const response = await app.inject({ url: '/healthz', headers: { 'x-request-id': supplied } });

      expect(response.headers['x-request-id']).toBe(supplied);
    } finally {
      await app.close();
    }
  });

  it('ignores a malformed inbound request id rather than logging it', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject({
        url: '/healthz',
        headers: { 'x-request-id': 'forged\nlog line' },
      });

      expect(response.headers['x-request-id']).not.toBe('forged\nlog line');
      expect(String(response.headers['x-request-id'])).toMatch(UUID_PATTERN);
    } finally {
      await app.close();
    }
  });
});
