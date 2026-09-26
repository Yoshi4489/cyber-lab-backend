import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('restricted application database role', () => {
  it('can perform application writes but cannot mutate audit history or schema', async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    const client = new Client({ connectionString: testDatabaseUrl });
    await client.connect();
    try {
      // A disposable role and its grants are rolled back with the test.
      await client.query('begin');
      await client.query('create role cyber_range_app nologin');
      const grants = await readFile(new URL('../scripts/db-app-role.sql', import.meta.url), 'utf8');
      await client.query(grants);
      await client.query('set role cyber_range_app');

      const eventId = randomUUID();
      await client.query(
        'insert into audit_events (id, event_type) values ($1, $2)',
        [eventId, 'test.restricted_app_role'],
      );
      await expectDenied(client, 'update audit_events set event_type = $1 where id = $2', [
        'test.tampered', eventId,
      ]);
      await expectDenied(client, 'delete from audit_events where id = $1', [eventId]);
      await expectDenied(client, 'truncate audit_events');
      await expectDenied(client, 'create table public.app_role_escape (id integer)');
      await expectDenied(client, 'delete from users where false');
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });
});

async function expectDenied(client: Client, query: string, parameters: unknown[] = []) {
  await client.query('savepoint before_denied_statement');
  try {
    await expect(client.query(query, parameters)).rejects.toMatchObject({ code: '42501' });
  } finally {
    await client.query('rollback to savepoint before_denied_statement');
  }
}
