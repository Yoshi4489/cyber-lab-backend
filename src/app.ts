import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerInstanceRoutes } from './routes/instances.js';

export async function buildApp(config: Config) {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });
  await app.register(helmet);
  await app.register(cors, { origin: config.FRONTEND_ORIGIN });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  app.get('/healthz', async () => ({ status: 'ok' }));
  await app.register(registerMetaRoutes, { prefix: '/v1' });
  await app.register(registerInstanceRoutes, { prefix: '/v1', config });
  return app;
}
