import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../src/db/client.js';

export default async function migrateTestDatabase() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) return;

  const database = createDatabase(databaseUrl);
  try {
    // Run migrations once before Vitest starts isolated workers. Running the
    // same PostgreSQL DDL concurrently can race while creating enum types.
    await migrate(database.db, { migrationsFolder: 'drizzle' });
  } finally {
    await database.close();
  }
}
