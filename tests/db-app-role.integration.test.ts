import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('restricted application database role', () => {
  it('connects as a separate login without audit mutation or schema privileges', async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    const owner = new Client({ connectionString: testDatabaseUrl });
    const login = `cyber_range_test_${randomBytes(8).toString('hex')}`;
    const password = randomBytes(32).toString('base64url');
    const appUrl = new URL(testDatabaseUrl);
    appUrl.username = login;
    appUrl.password = password;
    let app: Client | undefined;
    let groupCreated = false;
    let loginCreated = false;

    await owner.connect();
    try {
      await owner.query('create role cyber_range_app nologin');
      groupCreated = true;
      const createLogin = await owner.query<{ statement: string }>(
        "select format('create role %I login password %L', $1, $2) as statement",
        [login, password],
      );
      if (!createLogin.rows[0]) throw new Error('Could not format test login statement');
      await owner.query(createLogin.rows[0].statement);
      loginCreated = true;
      await owner.query(`grant cyber_range_app to ${login}`);
      const grants = await readFile(new URL('../scripts/db-app-role.sql', import.meta.url), 'utf8');
      await owner.query(grants);

      app = new Client({ connectionString: appUrl.toString() });
      await app.connect();
      const identity = await app.query<{ current_user: string }>('select current_user');
      expect(identity.rows[0]?.current_user).toBe(login);

      await app.query('begin');

      const eventId = randomUUID();
      await app.query(
        'insert into audit_events (id, event_type) values ($1, $2)',
        [eventId, 'test.restricted_app_role'],
      );
      await expectDenied(app, 'update audit_events set event_type = $1 where id = $2', [
        'test.tampered', eventId,
      ]);
      await expectDenied(app, 'delete from audit_events where id = $1', [eventId]);
      await expectDenied(app, 'truncate audit_events');
      await expectDenied(app, 'create table public.app_role_escape (id integer)');
      await expectDenied(app, 'alter table audit_events add column app_role_escape integer');
      await expectDenied(app, 'delete from users where false');
    } finally {
      if (app) {
        await app.query('rollback');
        await app.end();
      }
      if (loginCreated) await owner.query(`drop role ${login}`);
      if (groupCreated) {
        await owner.query('drop owned by cyber_range_app');
        await owner.query('drop role cyber_range_app');
      }
      await owner.end();
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
