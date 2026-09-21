import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { DrizzleAuthRepository } from './db/auth-repository.js';
import { createPasswordHasher } from './auth/password.js';
import { AuthenticationService } from './services/authentication.js';
import { LocalDevelopmentMailer } from './services/local-development-mailer.js';
import { DrizzleCatalogRepository } from './db/catalog-repository.js';
import { DrizzleScoringRepository } from './db/scoring-repository.js';
import { HmacInstanceFlagService } from './services/instance-flags.js';
import { SubmissionService } from './services/submissions.js';
import { notImplemented } from './lib/errors.js';

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required');

const database = createDatabase(config.DATABASE_URL);
const authentication = await AuthenticationService.create({
  repository: new DrizzleAuthRepository(database.db),
  passwordHasher: createPasswordHasher(),
  mailer: new LocalDevelopmentMailer(
    config.LOCAL_MAIL_DIRECTORY,
    config.FRONTEND_ORIGIN,
    config.NODE_ENV,
  ),
});
const submissionService = new SubmissionService(
  new DrizzleScoringRepository(database.db),
  {
    findOwnedInstance: () =>
      Promise.reject(notImplemented('Dynamic submissions require the instance lifecycle')),
  },
  new HmacInstanceFlagService(config.INSTANCE_FLAG_SECRET),
);
const app = await buildApp(config, {
  database,
  authentication,
  catalog: new DrizzleCatalogRepository(database.db),
  submissions: submissionService,
});

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
