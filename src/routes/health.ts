import type { FastifyInstance } from 'fastify';

export type ReadinessCheck = { name: string; status: 'ok' | 'error' };

/** A dependency `/readyz` should verify before declaring the service usable. */
export type ReadinessProbe = { name: string; check: () => Promise<void> };

/**
 * `/healthz` answers "is the process alive" — it must never touch a dependency,
 * or a database blip would get the container killed.
 *
 * `/readyz` answers "can this instance serve traffic". Phase 0 registers no
 * probes because the service has no runtime dependencies yet; Phase 1 adds
 * Postgres and Phase 3 adds Redis by passing them in here.
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  options: { probes?: readonly ReadinessProbe[] } = {},
) {
  const probes = options.probes ?? [];

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    const checks = await Promise.all(
      probes.map(async (probe): Promise<ReadinessCheck> => {
        try {
          await probe.check();
          return { name: probe.name, status: 'ok' };
        } catch {
          // The failure reason is for the log, not the response body.
          return { name: probe.name, status: 'error' };
        }
      }),
    );

    const ready = checks.every((check) => check.status === 'ok');
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'unready', checks });
  });
}
