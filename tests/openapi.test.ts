import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { signToken, testAppDependencies, testConfig } from './helpers.js';

const SAMPLE = CHALLENGE_DEFINITIONS[0];
if (SAMPLE === undefined) throw new Error('CHALLENGE_DEFINITIONS must not be empty');

describe('generated OpenAPI contract', () => {
  it('documents current operations, schemas and auth without publishing secrets', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject('/v1/openapi.json');
      const document = response.json();

      expect(response.statusCode).toBe(200);
      expect(document.openapi).toBe('3.0.3');
      expect(Object.keys(document.paths).sort()).toEqual([
        '/healthz', '/readyz', '/v1/meta', '/v1/categories', '/v1/challenges',
        '/v1/challenges/{slug}', '/v1/submissions', '/v1/instances',
        '/v1/instances/{id}', '/v1/instances/{id}/extend',
      ].sort());
      expect(document.components.securitySchemes.serviceToken).toMatchObject({
        type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
      });
      expect(document.paths['/v1/submissions'].post.security).toEqual([{ serviceToken: [] }]);
      expect(document.paths['/v1/submissions'].post.description).toContain('submissions:write');
      expect(document.paths['/v1/submissions'].post.requestBody.content['application/json'].schema)
        .toMatchObject({
          type: 'object',
          additionalProperties: false,
          required: ['challengeId', 'instanceId', 'flag'],
          properties: {
            instanceId: { type: 'string', format: 'uuid' },
            flag: { type: 'string', minLength: 1, maxLength: 256 },
          },
        });
      expect(document.paths['/v1/instances'].post.responses).toHaveProperty('501');
      expect(document.paths['/v1/instances'].post.responses).not.toHaveProperty('200');
      expect(document.paths['/readyz'].get.responses).toHaveProperty('503');
      expect(document.paths['/v1/challenges'].get.security ?? []).toEqual([]);
      expect(response.body).not.toContain(testConfig.BACKEND_SERVICE_TOKEN_SECRET);
      expect(response.body).not.toContain('CTF{');
    } finally {
      await app.close();
    }
  });

  it('validates submission bounds without coercion and preserves authentication order', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const headers = { authorization: `Bearer ${await signToken('submissions:write')}` };
      for (const flag of ['', 'x'.repeat(257), 123]) {
        const response = await app.inject({
          method: 'POST', url: '/v1/submissions', headers,
          payload: {
            challengeId: SAMPLE.id,
            instanceId: '00000000-0000-4000-8000-000000000003',
            flag,
          },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
        expect(response.headers['x-request-id']).toBe(response.json().correlationId);
      }

      const unauthenticated = await app.inject({
        method: 'POST', url: '/v1/submissions', payload: { flag: 123 },
      });
      expect(unauthenticated.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rate-limits submissions by the verified user identity', async () => {
    const app = await buildApp(
      { ...testConfig, SUBMISSION_RATE_LIMIT_MAX: 1 },
      testAppDependencies,
    );
    try {
      const request = {
        method: 'POST' as const,
        url: '/v1/submissions',
        headers: { authorization: `Bearer ${await signToken('submissions:write')}` },
        payload: {
          challengeId: SAMPLE.id,
          instanceId: '00000000-0000-4000-8000-000000000003',
          flag: 'CTF{fixture}',
        },
      };
      expect((await app.inject(request)).statusCode).toBe(501);
      const limited = await app.inject(request);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
    } finally {
      await app.close();
    }
  });

  it.each([
    { method: 'POST' as const, url: '/v1/instances', scope: 'instances:write' },
    { method: 'GET' as const, url: '/v1/instances/00000000-0000-4000-8000-000000000001', scope: 'instances:read' },
    { method: 'POST' as const, url: '/v1/instances/00000000-0000-4000-8000-000000000001/extend', scope: 'instances:write' },
    { method: 'DELETE' as const, url: '/v1/instances/00000000-0000-4000-8000-000000000001', scope: 'instances:write' },
  ])('preserves authenticated lifecycle stubs: $method $url', async ({ method, url, scope }) => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const request = {
        method,
        url,
        ...(url === '/v1/instances' ? { payload: { challengeId: SAMPLE.id } } : {}),
      };
      expect((await app.inject(request)).statusCode).toBe(401);
      const response = await app.inject({
        ...request,
        headers: { authorization: `Bearer ${await signToken(scope)}` },
      });
      expect(response.statusCode).toBe(501);
      expect(response.json()).toMatchObject({ code: 'NOT_IMPLEMENTED' });
    } finally {
      await app.close();
    }
  });
});
