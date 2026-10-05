import 'dotenv/config';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const execute = promisify(execFile);
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

async function fingerprint(client) {
  const tables = await client.query(`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN ('public', 'drizzle')
    ORDER BY n.nspname, c.relname
  `);
  const result = [];
  for (const table of tables.rows) {
    if (![table.schema, table.name].every((value) => /^[a-z_][a-z0-9_]*$/u.test(value))) {
      throw new Error('Unexpected table identifier');
    }
    const rows = await client.query(`
      SELECT count(*)::text AS count,
        md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), '')) AS digest
      FROM "${table.schema}"."${table.name}" t
    `);
    result.push({ ...table, ...rows.rows[0] });
  }
  return result;
}

/** Restore a consistent local snapshot; the callback receives only the disposable DB URL. */
export async function withRestoredDemoDatabase(check = async () => {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Restore drill is local-demo only');
  const source = new URL(process.env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || !loopback.has(source.hostname)) {
    throw new Error('Restore drill requires a loopback PostgreSQL source');
  }
  if (source.search || source.hash || !source.pathname.slice(1)) {
    throw new Error('Restore drill requires a plain local database URL');
  }
  const name = `cyber_range_restore_${randomUUID().replaceAll('-', '')}`;
  if (!/^cyber_range_restore_[a-f0-9]{32}$/u.test(name)) throw new Error('Unsafe restore name');
  const directory = await mkdtemp(join(tmpdir(), 'cyber-range-restore-'));
  const archive = join(directory, 'snapshot.dump');
  const admin = new pg.Pool({ connectionString: source.toString() });
  let restored;
  let created = false;
  let stage = 'snapshot';
  let client;
  try {
    client = await admin.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await client.query('SELECT pg_export_snapshot() AS id');
    const expected = await fingerprint(client);
    const environment = {
      ...process.env,
      PGHOST: source.hostname, PGPORT: source.port || '5432',
      PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password),
      PGDATABASE: decodeURIComponent(source.pathname.slice(1)), PGCONNECT_TIMEOUT: '5',
      PGSSLMODE: 'prefer',
    };
    await execute(process.env.PG_DUMP_PATH || 'pg_dump', [
      '--format=custom', '--no-owner', '--no-privileges',
      `--snapshot=${snapshot.rows[0].id}`, `--file=${archive}`,
    ], { env: environment, windowsHide: true, timeout: 60_000 });
    await chmod(archive, 0o600);
    await client.query('COMMIT');
    stage = 'restore';
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await execute(process.env.PG_RESTORE_PATH || 'pg_restore', [
      `--dbname=${name}`, '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', archive,
    ], { env: environment, windowsHide: true, timeout: 60_000 });
    const target = new URL(source);
    target.pathname = `/${name}`;
    restored = new pg.Pool({ connectionString: target.toString() });
    stage = 'data comparison';
    const actual = await fingerprint(restored);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Restored data differs');
    process.stdout.write(`Local backup/restore passed: ${actual.length} table fingerprints match.\n`);
    stage = 'callback validation';
    await check(target.toString());
  } catch {
    throw new Error(`Local restore drill failed during ${stage}; connection settings and database contents suppressed`);
  } finally {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await restored?.end();
    try {
      if (created) {
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        process.stdout.write('Disposable restored database removed; source database preserved.\n');
      }
    } finally {
      await admin.end();
      // Remove only the generated archive and its now-empty, verified temporary directory.
      const root = resolve(tmpdir());
      if (resolve(directory).startsWith(`${root}\\`) || resolve(directory).startsWith(`${root}/`)) {
        await rm(archive, { force: true });
        await rmdir(directory);
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await withRestoredDemoDatabase(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
