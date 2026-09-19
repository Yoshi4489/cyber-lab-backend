import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

export function createDatabase(databaseUrl: string) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return drizzle(neon(databaseUrl));
}
