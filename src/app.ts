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
import type { AuthenticationService } from './services/authentication.js';
import { registerAuthenticationRoutes } from './routes/authentication.js';
import type { ServiceSessionAuthorizer } from './auth/require-scope.js';
import type { CatalogRepository } from './services/catalog-repository.js';
import type { SubmissionService } from './services/submissions.js';
import { FixedWindowUserRateLimiter } from './services/user-rate-limiter.js';
import type { ProgressRepository } from './services/progress-repository.js';
import { registerProgressRoutes } from './routes/progress.js';
import type { InstanceLifecycleService } from './services/instance-lifecycle.js';

export type AppDependencies = {
  database?: DatabaseClient;
  authentication?: AuthenticationService;
  sessionAuthorizer?: ServiceSessionAuthorizer;
  catalog?: CatalogRepository;
  submissions?: SubmissionService;
  progress?: ProgressRepository;
  instances?: InstanceLifecycleService;
};

const unavailableCatalog: CatalogRepository = {
  listCategories: () => Promise.reject(new Error('Catalog repository unavailable')),
  listPublishedChallenges: () => Promise.reject(new Error('Catalog repository unavailable')),
  findPublishedChallengeBySlug: () => Promise.reject(new Error('Catalog repository unavailable')),
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
  if (dependencies.authentication) {
    await app.register(registerAuthenticationRoutes, {
      prefix: '/v1',
      config,
      authentication: dependencies.authentication,
    });
  }
  const sessionAuthorizer =
    dependencies.sessionAuthorizer ??
    dependencies.authentication ?? {
      validateServiceSession: () => Promise.reject(new Error('Session authorizer unavailable')),
    };
  const submissionRateLimiter = new FixedWindowUserRateLimiter(
    config.SUBMISSION_RATE_LIMIT_MAX,
    config.SUBMISSION_RATE_LIMIT_WINDOW_MS,
  );
  const instanceRateLimiter = new FixedWindowUserRateLimiter(
    config.INSTANCE_RATE_LIMIT_MAX,
    config.INSTANCE_RATE_LIMIT_WINDOW_MS,
  );
  await app.register(registerMetaRoutes, { prefix: '/v1' });
  await app.register(registerChallengeRoutes, {
    prefix: '/v1',
    catalog: dependencies.catalog ?? unavailableCatalog,
  });
  await app.register(registerSubmissionRoutes, {
    prefix: '/v1',
    config,
    sessionAuthorizer,
    rateLimiter: submissionRateLimiter,
    ...(dependencies.submissions ? { submissions: dependencies.submissions } : {}),
  });
  await app.register(registerProgressRoutes, {
    prefix: '/v1',
    config,
    sessionAuthorizer,
    ...(dependencies.progress ? { progress: dependencies.progress } : {}),
  });
  await app.register(registerInstanceRoutes, {
    prefix: '/v1',
    config,
    sessionAuthorizer,
    rateLimiter: instanceRateLimiter,
    ...(dependencies.instances ? { instances: dependencies.instances } : {}),
  });
  return app;
}
