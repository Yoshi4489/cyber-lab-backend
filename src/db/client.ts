import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export type DatabaseClient = {
  db: Database;
  check: () => Promise<void>;
  close: () => Promise<void>;
};

export function createDatabase(databaseUrl: string): DatabaseClient {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool, schema });

  return {
    db,
    check: async () => {
      await pool.query('select 1');
    },
    close: async () => {
      await pool.end();
    },
  };
}
