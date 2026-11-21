import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';

const envFile = process.env.LOKALCHAT_RECOVERY_DB_ENV;
test('real SQL service windows isolate accounts and phone connections and ignore late events', { skip: !envFile }, async () => {
  const env = parseEnv(readFileSync(envFile, 'utf8'));
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(env.DB_URL).hostname));
  const sql = postgres(env.DB_URL, { max: 2, onnotice() {} });
  const schema = `whatsapp_window_test_${Date.now()}`;
  const owner = '11111111-1111-1111-1111-111111111111';
  const other = '22222222-2222-2222-2222-222222222222';
  const query = statement => sql.unsafe(statement.replaceAll('TEST.', `${schema}.`));
  try {
    await query(`CREATE SCHEMA ${schema};
      CREATE TABLE TEST.profiles(id uuid PRIMARY KEY);
      CREATE TABLE TEST.whatsapp_connections(business_id uuid,phone_number_id text);
      INSERT INTO TEST.profiles VALUES ('${owner}'),('${other}');
      INSERT INTO TEST.whatsapp_connections VALUES ('${owner}','phone-a'),('${other}','phone-b');`);
    const migration = readFileSync(new URL('../supabase/migrations/20261120080000_whatsapp_service_windows.sql', import.meta.url), 'utf8').replaceAll('public.', `${schema}.`);
    await sql.unsafe(migration);
    const record = async (business, phone, recipient, timestamp) => (await sql.unsafe(`SELECT ${schema}.record_whatsapp_customer_event($1,$2,$3,$4) AS ok`, [business, phone, recipient, timestamp]))[0].ok;
    const recent = new Date(Date.now() - 60000).toISOString();
    const older = new Date(Date.now() - 120000).toISOString();
    assert.equal(await record(owner, 'phone-a', 'MY.a1', recent), true);
    assert.equal(await record(owner, 'phone-a', 'MY.a1', older), true);
    assert.equal(await record(owner, 'phone-a', 'MY.a1', recent), true);
    assert.equal(await record(owner, 'phone-b', 'MY.a1', recent), false);
    assert.equal(await record(other, 'phone-b', 'MY.a1', older), true);
    assert.equal(await record(owner, 'phone-a', 'MY.a1', new Date(Date.now() + 86400000).toISOString()), false);
    const rows = await query(`SELECT business_id,phone_number_id,last_customer_message_at FROM TEST.whatsapp_service_windows ORDER BY business_id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].last_customer_message_at.toISOString(), recent);
    assert.equal(rows[1].last_customer_message_at.toISOString(), older);
    const boundary = await query(`SELECT
      clock_timestamp() - interval '24 hours' > clock_timestamp() - interval '24 hours' AS exact_open,
      has_function_privilege('anon','${schema}.record_whatsapp_customer_event(uuid,text,text,timestamptz)','EXECUTE') AS anon_execute,
      has_table_privilege('authenticated','${schema}.whatsapp_service_windows','INSERT') AS can_forge`);
    assert.equal(boundary[0].exact_open, false);
    assert.equal(boundary[0].anon_execute, false);
    assert.equal(boundary[0].can_forge, false);
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await sql.end();
  }
});
