import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';

const envFile = process.env.LOKALCHAT_RECOVERY_DB_ENV;
test('recovery SQL: lease expiry, concurrency, backoff, exhaustion and privileges', { skip: !envFile }, async () => {
  const env = parseEnv(readFileSync(envFile, 'utf8'));
  const url = new URL(env.DB_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  const sql = postgres(env.DB_URL, { max: 1 });
  const schema = `recovery_test_${Date.now()}`;
  try {
    await sql.begin(async tx => {
      await tx.unsafe(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.chats(id uuid PRIMARY KEY, business_id uuid, customer_phone text);
        CREATE TABLE ${schema}.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid, sender text, text text, external_message_id text,
          processing_status text, processing_started_at timestamptz, processed_at timestamptz, created_at timestamptz DEFAULT now());`);
      const migration = readFileSync(new URL('../supabase/migrations/20261117060000_inbound_recovery.sql', import.meta.url), 'utf8')
        .replaceAll('public.', `${schema}.`).replaceAll('search_path = public,', `search_path = ${schema},`);
      await tx.unsafe(migration);
      const chat = '11111111-1111-1111-1111-111111111111';
      await tx.unsafe(`INSERT INTO ${schema}.chats VALUES ('${chat}', '${chat}', '601111');
        INSERT INTO ${schema}.messages(chat_id,sender,text,external_message_id,processing_status) VALUES ('${chat}','customer','hello','wa-test','pending');`);
      const claim = async () => (await tx.unsafe(`SELECT ${schema}.claim_inbound_message('${chat}','wa-test') AS ok`))[0].ok;
      assert.equal((await tx.unsafe(`SELECT * FROM ${schema}.list_recoverable_inbound_messages()`)).length, 1);
      assert.equal(await claim(), true);
      assert.equal(await claim(), false);
      assert.equal((await tx.unsafe(`SELECT * FROM ${schema}.list_recoverable_inbound_messages()`)).length, 0);
      await tx.unsafe(`UPDATE ${schema}.messages SET processing_started_at = now() - interval '11 minutes'`);
      assert.equal(await claim(), true);
      await tx.unsafe(`UPDATE ${schema}.messages SET processing_status='failed', processed_at=now()`);
      assert.equal(await claim(), false);
      await tx.unsafe(`UPDATE ${schema}.messages SET processed_at=now()-interval '2 minutes'`);
      assert.equal(await claim(), true);
      await tx.unsafe(`UPDATE ${schema}.messages SET processing_attempts=8, processing_started_at=now()-interval '11 minutes'`);
      assert.equal((await tx.unsafe(`SELECT * FROM ${schema}.list_recoverable_inbound_messages()`)).length, 0);
      assert.equal((await tx.unsafe(`SELECT processing_status FROM ${schema}.messages`))[0].processing_status,'failed');
      assert.equal(await claim(), false);
      const permissions = await tx.unsafe(`SELECT has_function_privilege('anon','${schema}.list_recoverable_inbound_messages()','EXECUTE') AS allowed`);
      assert.equal(permissions[0].allowed, false);
      await tx.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    });
  } finally { await sql.end(); }
});
