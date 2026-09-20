import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerHealthRoutes } from '../src/routes/health.js';
import { testConfig } from './helpers.js';

describe('health endpoints', () => {
  it('reports liveness', async () => {
    const app = await buildApp(testConfig);
    try {
      const response = await app.inject('/healthz');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('reports readiness while no dependencies are registered', async () => {
    const app = await buildApp(testConfig);
    try {
      const response = await app.inject('/readyz');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ready', checks: [] });
    } finally {
      await app.close();
    }
  });

  it('reports 503 and names the failing dependency when a probe throws', async () => {
    const app = Fastify({ logger: false });
    await app.register(registerHealthRoutes, {
      probes: [
        { name: 'postgres', check: () => Promise.reject(new Error('connection refused')) },
        { name: 'redis', check: () => Promise.resolve() },
      ],
    });

    try {
      const response = await app.inject('/readyz');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'unready',
        checks: [
          { name: 'postgres', status: 'error' },
          { name: 'redis', status: 'ok' },
        ],
      });
      // The underlying failure stays in the log, never in the body.
      expect(response.body).not.toContain('connection refused');
    } finally {
      await app.close();
    }
  });
});
