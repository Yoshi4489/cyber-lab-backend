import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import { buildLoggerOptions } from './lib/logger.js';
import { generateRequestId, registerCorrelation } from './plugins/correlation.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerOpenApi } from './plugins/openapi.js';
import { registerChallengeRoutes } from './routes/challenges.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerSubmissionRoutes } from './routes/submissions.js';
import { registerInstanceRoutes } from './routes/instances.js';
import type { DatabaseClient } from './db/client.js';

export type AppDependencies = {
  database?: DatabaseClient;
};

export async function buildApp(config: Config, dependencies: AppDependencies = {}) {
  const app = Fastify({
    logger: buildLoggerOptions(config),
    genReqId: generateRequestId,
  });

  registerErrorHandler(app);
  registerCorrelation(app);

  if (dependencies.database) {
    app.addHook('onClose', async () => {
      await dependencies.database?.close();
    });
  }

  await app.register(helmet);
  await app.register(cors, { origin: config.FRONTEND_ORIGIN });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await registerOpenApi(app);

  // Unprefixed: orchestrators and uptime monitors expect fixed paths.
  await app.register(registerHealthRoutes, {
    probes: dependencies.database
      ? [{ name: 'postgres', check: dependencies.database.check }]
      : [],
  });
  await app.register(registerMetaRoutes, { prefix: '/v1' });
  await app.register(registerChallengeRoutes, { prefix: '/v1' });
  await app.register(registerSubmissionRoutes, { prefix: '/v1', config });
  await app.register(registerInstanceRoutes, { prefix: '/v1', config });
  return app;
}
