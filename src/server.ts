import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { DrizzleAuthRepository } from './db/auth-repository.js';
import { createPasswordHasher } from './auth/password.js';
import { AuthenticationService } from './services/authentication.js';
import { LocalDevelopmentMailer } from './services/local-development-mailer.js';

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
const app = await buildApp(config, { database, authentication });

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
