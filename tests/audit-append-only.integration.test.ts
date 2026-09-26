import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('audit event persistence', () => {
  it('rejects direct updates and deletes while allowing inserts', async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    const client = new Client({ connectionString: testDatabaseUrl });
    await client.connect();
    try {
      await client.query('begin');
      const id = randomUUID();
      await client.query(
        'insert into audit_events (id, event_type, details) values ($1, $2, $3)',
        [id, 'test.audit_append_only', '{}'],
      );
      await client.query('savepoint before_update');
      await expect(client.query('update audit_events set event_type = $1 where id = $2', [
        'test.changed', id,
      ])).rejects.toMatchObject({ code: '55000' });
      await client.query('rollback to savepoint before_update');

      await client.query('savepoint before_delete');
      await expect(client.query('delete from audit_events where id = $1', [id]))
        .rejects.toMatchObject({ code: '55000' });
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });

  it('retains an audit row when a referenced test account is deleted', async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');
    const client = new Client({ connectionString: testDatabaseUrl });
    await client.connect();
    try {
      await client.query('begin');
      const userId = randomUUID();
      const eventId = randomUUID();
      await client.query(
        'insert into users (id, email, password_hash) values ($1, $2, $3)',
        [userId, `audit-${userId}@example.test`, 'test-only-placeholder-hash'],
      );
      await client.query(
        'insert into audit_events (id, actor_user_id, target_user_id, event_type) values ($1, $2, $2, $3)',
        [eventId, userId, 'test.audit_account_deleted'],
      );
      await client.query('delete from users where id = $1', [userId]);
      const result = await client.query(
        'select actor_user_id, target_user_id from audit_events where id = $1', [eventId],
      );
      expect(result.rows).toEqual([{ actor_user_id: null, target_user_id: null }]);
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });
});
