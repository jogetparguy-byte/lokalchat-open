import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
const envFile=process.env.LOKALCHAT_RECOVERY_DB_ENV;
test('inbound SQL: atomic media handoff, duplicate epochs, identity isolation and service-window commit', {skip:!envFile},async()=>{
  const env=parseEnv(readFileSync(envFile,'utf8'));
  assert.ok(['localhost','127.0.0.1'].includes(new URL(env.DB_URL).hostname));
  const sql=postgres(env.DB_URL,{max:1,onnotice(){}}),schema=`wa_inbound_test_${Date.now()}`;
  const business='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
  const q=statement=>sql.unsafe(statement.replaceAll('TEST.',schema+'.'));
  try {
    await q(`CREATE SCHEMA ${schema};
      CREATE TABLE TEST.profiles(id uuid PRIMARY KEY);
      CREATE TABLE TEST.whatsapp_connections(business_id uuid,phone_number_id text);
      CREATE TABLE TEST.chats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,customer_phone text,customer_name text,last_message text,updated_at timestamptz DEFAULT now(),is_bot_active boolean DEFAULT true,bot_generation integer DEFAULT 0);
      CREATE UNIQUE INDEX chat_phone_unique ON TEST.chats(business_id,customer_phone);
      CREATE TABLE TEST.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chat_id uuid,sender text,text text,external_message_id text,processing_status text DEFAULT 'done',processed_at timestamptz,bot_generation integer,allow_dry_run boolean);
      CREATE UNIQUE INDEX inbound_external_unique ON TEST.messages(chat_id,external_message_id);
      CREATE FUNCTION TEST.bump_epoch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.bot_generation:=OLD.bot_generation+1;RETURN NEW;END $$;
      CREATE TRIGGER bump_epoch BEFORE UPDATE OF is_bot_active ON TEST.chats FOR EACH ROW EXECUTE FUNCTION TEST.bump_epoch();
      INSERT INTO TEST.profiles VALUES ('${business}'),('${other}');
      INSERT INTO TEST.whatsapp_connections VALUES ('${business}','phone1'),('${other}','phone2');`);
    // Production migration order: PL/pgSQL resolves the window function at invocation, after both migrations.
    for(const file of ['20261120070000_whatsapp_inbound_content.sql','20261120080000_whatsapp_service_windows.sql']) {
      await sql.unsafe(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8').replaceAll('public.',schema+'.').replaceAll('search_path = public,',`search_path = ${schema},`));
    }
    const ingest=async({id='image-1',phone='60123456789',bsuid=null,type='image',handoff=true,owner=business,providerPhone='phone1',timestamp='2026-11-19T00:00:00Z'}={})=>(await sql.unsafe(`SELECT * FROM ${schema}.persist_whatsapp_inbound($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[owner,id,phone,bsuid,'Buyer',type,'Inbound '+id,JSON.stringify({}),handoff,providerPhone,timestamp]))[0];
    const first=await ingest();
    let chat=(await q(`SELECT * FROM TEST.chats WHERE id='${first.chat_id}'`))[0];
    assert.equal(chat.is_bot_active,false);assert.equal(chat.bot_generation,1);
    const inbound=(await q(`SELECT * FROM TEST.messages WHERE external_message_id='image-1'`))[0];
    assert.equal(inbound.processing_status,'done');assert.ok(inbound.processed_at);assert.equal(inbound.inbound_type,'image');
    assert.equal((await q(`SELECT count(*)::int AS n FROM TEST.messages WHERE sender='system'`))[0].n,1);
    assert.equal((await q(`SELECT recipient_id FROM TEST.whatsapp_service_windows`))[0].recipient_id,'60123456789');
    await q(`UPDATE TEST.chats SET is_bot_active=true,last_message='New human turn' WHERE id='${first.chat_id}'`);
    await ingest();
    chat=(await q(`SELECT * FROM TEST.chats WHERE id='${first.chat_id}'`))[0];
    assert.equal(chat.is_bot_active,true);assert.equal(chat.bot_generation,2);assert.equal(chat.last_message,'New human turn');
    assert.equal((await q(`SELECT count(*)::int AS n FROM TEST.messages`))[0].n,2);
    const alias=await ingest({id:'text-2',bsuid:'MY.ABC123',type:'text',handoff:false});
    assert.equal(alias.chat_id,first.chat_id);assert.equal(alias.recipient_id,'MY.ABC123');
    assert.equal((await q(`SELECT count(*)::int AS n FROM TEST.whatsapp_service_windows WHERE recipient_id='MY.ABC123'`))[0].n,1);
    const hidden=await ingest({id:'bsuid-3',phone:null,bsuid:'MY.ABC123',type:'interactive',handoff:false});
    assert.equal(hidden.chat_id,first.chat_id);
    const independent=await ingest({id:'other-1',phone:null,bsuid:'MY.ABC123',owner:other,providerPhone:'phone2'});
    assert.notEqual(independent.chat_id,first.chat_id);
    assert.equal((await q(`SELECT has_function_privilege('anon','${schema}.persist_whatsapp_inbound(uuid,text,text,text,text,text,text,jsonb,boolean,text,timestamptz)','EXECUTE') AS allowed`))[0].allowed,false);
    // A failing window write rolls back queue insertion and chat changes together.
    await q(`CREATE OR REPLACE FUNCTION TEST.record_whatsapp_customer_event(p_business_id uuid,p_phone_number_id text,p_recipient_id text,p_provider_timestamp timestamptz) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'window unavailable';END $$;`);
    await assert.rejects(ingest({id:'rolled-back',type:'text',handoff:false}),/window unavailable/);
    assert.equal((await q(`SELECT count(*)::int AS n FROM TEST.messages WHERE external_message_id='rolled-back'`))[0].n,0);
  } finally {await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await sql.end();}
});
