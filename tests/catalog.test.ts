import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MOCK_CHALLENGES, mockFlag } from '../src/mocks/challenges.js';
import { signToken, testAppDependencies, testConfig } from './helpers.js';

const SAMPLE = MOCK_CHALLENGES[0];
const HEX_64 = /[0-9a-f]{64}/;

if (SAMPLE === undefined) throw new Error('MOCK_CHALLENGES must not be empty');

describe('mock catalog', () => {
  it('lists every mock challenge and labels the data as mock', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject('/v1/challenges');
      const body = response.json<{ challenges: unknown[]; source: string }>();

      expect(response.statusCode).toBe(200);
      expect(body.source).toBe('mock');
      expect(body.challenges).toHaveLength(MOCK_CHALLENGES.length);
    } finally {
      await app.close();
    }
  });

  it('returns a single challenge by slug', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject(`/v1/challenges/${SAMPLE.slug}`);

      expect(response.statusCode).toBe(200);
      expect(response.json<{ id: string }>().id).toBe(SAMPLE.id);
    } finally {
      await app.close();
    }
  });

  it('answers an unknown slug with NOT_FOUND', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject('/v1/challenges/no-such-challenge');

      expect(response.statusCode).toBe(404);
      expect(response.json<{ code: string }>().code).toBe('NOT_FOUND');
    } finally {
      await app.close();
    }
  });

  it('exposes no flag and no flag hash anywhere in the catalog', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const list = await app.inject('/v1/challenges');
      const detail = await app.inject(`/v1/challenges/${SAMPLE.slug}`);

      for (const body of [list.body, detail.body]) {
        expect(body).not.toContain('CTF{');
        expect(body).not.toMatch(HEX_64);
      }
    } finally {
      await app.close();
    }
  });

  it('lists the distinct categories', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject('/v1/categories');
      const { categories } = response.json<{ categories: string[] }>();

      expect(response.statusCode).toBe(200);
      expect(categories).toContain(SAMPLE.category);
      expect(new Set(categories).size).toBe(categories.length);
    } finally {
      await app.close();
    }
  });
});

describe('mock flag submission', () => {
  it('requires a token', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/submissions',
        payload: { challengeId: SAMPLE.id, flag: mockFlag(SAMPLE.slug) },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json<{ code: string }>().code).toBe('UNAUTHORIZED');
    } finally {
      await app.close();
    }
  });

  it('accepts the derived mock flag but records nothing yet', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/submissions',
        headers: { authorization: `Bearer ${await signToken('submissions:write')}` },
        payload: { challengeId: SAMPLE.id, flag: mockFlag(SAMPLE.slug) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        correct: true,
        points: SAMPLE.points,
        recorded: false,
        source: 'mock',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects a wrong flag without revealing the right one', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/submissions',
        headers: { authorization: `Bearer ${await signToken('submissions:write')}` },
        payload: { challengeId: SAMPLE.id, flag: 'CTF{definitely_wrong}' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ correct: boolean; points: number }>()).toMatchObject({
        correct: false,
        points: 0,
      });
      // Neither the expected flag nor the submitted one comes back.
      expect(response.body).not.toContain(mockFlag(SAMPLE.slug));
      expect(response.body).not.toContain('definitely_wrong');
      expect(response.body).not.toMatch(HEX_64);
    } finally {
      await app.close();
    }
  });

  it('answers an unknown challenge id with NOT_FOUND', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/submissions',
        headers: { authorization: `Bearer ${await signToken('submissions:write')}` },
        payload: { challengeId: '00000000-0000-4000-8000-000000000000', flag: 'CTF{x}' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json<{ code: string }>().code).toBe('NOT_FOUND');
    } finally {
      await app.close();
    }
  });

  it('rejects a body with an unexpected field', async () => {
    const app = await buildApp(testConfig, testAppDependencies);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/submissions',
        headers: { authorization: `Bearer ${await signToken('submissions:write')}` },
        payload: { challengeId: SAMPLE.id, flag: 'CTF{x}', userId: 'someone-else' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('INVALID_REQUEST');
    } finally {
      await app.close();
    }
  });
});
