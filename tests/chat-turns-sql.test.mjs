import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
const envFile = process.env.LOKALCHAT_RECOVERY_DB_ENV;
test('real SQL serializes chat turns and fences bot replies across manual/AI takeover', { skip: !envFile }, async () => {
  const env = parseEnv(readFileSync(envFile,'utf8'));
  assert.ok(['localhost','127.0.0.1'].includes(new URL(env.DB_URL).hostname));
  const sql = postgres(env.DB_URL,{max:4,onnotice() {}});
  const schema = `chat_turn_test_${Date.now()}`;
  const chat = '11111111-1111-1111-1111-111111111111';
  const chat2 = '22222222-2222-2222-2222-222222222222';
  const query = statement => sql.unsafe(statement.replaceAll('TEST.',`${schema}.`));
  try {
    await query(`CREATE SCHEMA ${schema}; CREATE TABLE TEST.chats(id uuid PRIMARY KEY,business_id uuid,customer_phone text,is_bot_active boolean DEFAULT true);
      CREATE TABLE TEST.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chat_id uuid,sender text,text text,external_message_id text,
        processing_status text DEFAULT 'done',processing_started_at timestamptz,processed_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),
        reply_sequence integer DEFAULT 0,reply_to_external_message_id text,delivery_status text,delivery_started_at timestamptz,delivery_attempts integer DEFAULT 0,last_delivery_error text,sent_at timestamptz,
        CONSTRAINT messages_delivery_status_check CHECK(delivery_status IN ('pending','sending','sent','failed')));`);
    for (const file of ['20261024090500_dashboard_human_delivery_retry.sql','20261117060000_inbound_recovery.sql','20261117070000_chat_turns_and_handoff.sql']) {
      const migration = readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')
        .replaceAll('public.',`${schema}.`).replaceAll('search_path = public,',`search_path = ${schema},`);
      await sql.unsafe(migration);
    }
    await query(`INSERT INTO TEST.chats(id,business_id,customer_phone) VALUES ('${chat}','${chat}','6011'),('${chat2}','${chat2}','6022');
      INSERT INTO TEST.messages(chat_id,sender,text,external_message_id,processing_status,created_at) VALUES
        ('${chat}','customer','first','first','pending','2026-11-17 01:00:00Z'),
        ('${chat}','customer','second','second','pending','2026-11-17 01:00:01Z'),
        ('${chat2}','customer','independent','other','pending','2026-11-17 01:00:00Z');`);
    await query(`UPDATE TEST.messages SET bot_generation=0 WHERE sender='customer'`);
    const claim = async (id, message) => (await query(`SELECT TEST.claim_inbound_message('${id}','${message}') AS ok`))[0].ok;
    const claims = await Promise.all([claim(chat,'first'),claim(chat,'second'),claim(chat,'first')]);
    assert.equal(Number(claims[0])+Number(claims[2]),1);
    assert.equal(claims[1],false);
    assert.equal(await claim(chat2,'other'),true);
    let history = await query(`SELECT * FROM TEST.load_chat_turn_history('${chat}','first')`);
    assert.deepEqual(history.map(row=>row.text),['first']);
    await query(`UPDATE TEST.messages SET processing_status='done' WHERE external_message_id='first'`);
    assert.equal(await claim(chat,'second'),true);
    let token = (await query(`SELECT processing_token FROM TEST.messages WHERE external_message_id='second'`))[0].processing_token;
    // A replaced attempt token cannot authorize a send or mark the newer attempt complete.
    await query(`UPDATE TEST.messages SET processing_started_at=now()-interval '11 minutes' WHERE external_message_id='second'`);
    const newerToken=(await query(`SELECT TEST.claim_chat_turn('${chat}','second') AS token`))[0].token;
    assert.ok(newerToken); assert.notEqual(newerToken,token);
    await query(`SELECT TEST.finish_chat_turn('${chat}','second','${token}','done')`);
    assert.equal((await query(`SELECT processing_status FROM TEST.messages WHERE external_message_id='second'`))[0].processing_status,'processing');
    const expiredToken=token;
    token = newerToken;
    const [answer] = await query(`INSERT INTO TEST.messages(chat_id,sender,text,delivery_status,bot_generation,bot_reply_kind,reply_to_external_message_id)
      VALUES ('${chat}','bot','sale','pending',0,'answer','second') RETURNING id`);
    const gate = async id => (await query(`SELECT TEST.claim_bot_reply('${id}','${token}') AS status`))[0].status;
    assert.equal((await query(`SELECT TEST.claim_bot_reply('${answer.id}','${expiredToken}') AS status`))[0].status,'busy');
    assert.equal((await query(`SELECT TEST.handoff_chat('${chat}',0,'${expiredToken}') AS generation`))[0].generation,null);
    await query(`UPDATE TEST.chats SET is_bot_active=false WHERE id='${chat}'; UPDATE TEST.chats SET is_bot_active=true WHERE id='${chat}'`);
    assert.equal(await gate(answer.id),'cancelled');
    assert.equal((await query(`SELECT TEST.handoff_chat('${chat}',0,'${token}') AS generation`))[0].generation,null);
    assert.equal((await query(`SELECT TEST.handoff_chat('${chat}',2,'${token}') AS generation`))[0].generation,3);
    const [confirmation] = await query(`INSERT INTO TEST.messages(chat_id,sender,text,delivery_status,bot_generation,bot_reply_kind,reply_to_external_message_id)
      VALUES ('${chat}','bot','handoff','pending',3,'handoff','second') RETURNING id`);
    assert.equal(await gate(confirmation.id),'claimed');
    // An explicit manual pause invalidates even an already-paused AI handoff epoch.
    await query(`UPDATE TEST.chats SET is_bot_active=false WHERE id='${chat}'`);
    assert.equal(await gate(confirmation.id),'cancelled');
    const [legacy] = await query(`INSERT INTO TEST.messages(chat_id,sender,text,delivery_status,reply_to_external_message_id) VALUES ('${chat}','bot','legacy','pending','second') RETURNING id`);
    assert.equal(await gate(legacy.id),'cancelled');
    await query(`UPDATE TEST.messages SET processing_started_at=now()-interval '11 minutes' WHERE external_message_id='other';
      UPDATE TEST.chats SET is_bot_active=false WHERE id='${chat2}'; UPDATE TEST.chats SET is_bot_active=true WHERE id='${chat2}'`);
    assert.equal((await query(`SELECT TEST.claim_chat_turn('${chat2}','other') AS token`))[0].token,null);
    assert.equal((await query(`SELECT processing_status FROM TEST.messages WHERE external_message_id='other'`))[0].processing_status,'done');
    for (const fn of ['claim_bot_reply(uuid,uuid)','handoff_chat(uuid,integer,uuid)','load_chat_turn_history(uuid,text)']) {
      assert.equal((await query(`SELECT has_function_privilege('anon','${schema}.${fn}','EXECUTE') AS allowed`))[0].allowed,false);
    }
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await sql.end();
  }
});
