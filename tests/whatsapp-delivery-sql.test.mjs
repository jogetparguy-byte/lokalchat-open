import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import postgres from 'postgres';
const envFile=process.env.LOKALCHAT_RECOVERY_DB_ENV;
test('delivery SQL: early events, duplicates, reordering, retry isolation and tenant privileges',{skip:!envFile},async()=>{
 const env=parseEnv(readFileSync(envFile,'utf8'));assert.ok(['localhost','127.0.0.1'].includes(new URL(env.DB_URL).hostname));
 const sql=postgres(env.DB_URL,{max:1,onnotice(){}}),schema=`wa_delivery_${Date.now()}`;
 const owner='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',chat='33333333-3333-3333-3333-333333333333',message='44444444-4444-4444-4444-444444444444';
 const q=s=>sql.unsafe(s.replaceAll('TEST.',schema+'.'));
 try{
  await q(`CREATE SCHEMA ${schema}; CREATE TABLE TEST.profiles(id uuid PRIMARY KEY); CREATE TABLE TEST.chats(id uuid PRIMARY KEY,business_id uuid); CREATE TABLE TEST.messages(id uuid PRIMARY KEY,chat_id uuid,sender text,delivery_status text,sent_at timestamptz,last_delivery_error text); INSERT INTO TEST.profiles VALUES('${owner}'),('${other}'); INSERT INTO TEST.chats VALUES('${chat}','${owner}');INSERT INTO TEST.messages(id,chat_id,sender,delivery_status)VALUES('${message}','${chat}','human','sending');`);
  await sql.unsafe(readFileSync(new URL('../supabase/migrations/20261120032537_whatsapp_delivery_tracking.sql',import.meta.url),'utf8').replaceAll('public.',schema+'.'));
  const event=(id,status,ownerId=owner,phone='phone')=>sql.unsafe(`SELECT ${schema}.record_whatsapp_delivery_status($1,$2,$3,$4,$5,$6)`,[ownerId,phone,id,status,'2026-11-20T00:00:00Z',status==='failed'?'Meta gagal menghantar.':null]);
  const accept=(id,ownerId=owner)=>sql.unsafe(`SELECT ${schema}.register_whatsapp_acceptance($1,$2,$3,$4)`,[ownerId,message,'phone',id]);
  const status=async()=> (await q('SELECT * FROM TEST.messages'))[0];
  await event('wamid.1','read');await accept('wamid.1');assert.equal((await status()).provider_delivery_status,'read');
  for(const s of ['sent','delivered','failed','read']) await event('wamid.1',s);
  assert.equal((await status()).provider_delivery_status,'read');assert.equal((await status()).delivery_status,'sent');
  assert.equal((await q('SELECT count(*)::int AS n FROM TEST.whatsapp_delivery_events'))[0].n,4);
  await event('wamid.2','failed');await accept('wamid.2');assert.equal((await status()).delivery_status,'failed');
  await event('wamid.2','sent');assert.equal((await status()).provider_delivery_status,'failed');
  await accept('wamid.3');await event('wamid.2','read');assert.equal((await status()).provider_delivery_status,'accepted');
  await event('wamid.3','delivered',other);await event('wamid.3','read',owner,'other-phone');assert.equal((await status()).provider_delivery_status,'accepted');
  await assert.rejects(accept('bad-owner',other),/owner mismatch/);
  await event('wamid.3','delivered');await event('wamid.3','failed');assert.equal((await status()).provider_delivery_status,'delivered');
  await sql.unsafe(`SELECT ${schema}.register_whatsapp_report_acceptance($1,$2,$3)`,[owner,'phone','report']);await event('report','failed');
  assert.equal((await q(`SELECT weekly_report_provider_status FROM TEST.profiles WHERE id='${owner}'`))[0].weekly_report_provider_status,'failed');
  assert.equal((await q(`SELECT has_function_privilege('authenticated','${schema}.register_whatsapp_acceptance(uuid,uuid,text,text)','EXECUTE') AS allowed`))[0].allowed,false);
  assert.equal((await q(`SELECT has_function_privilege('service_role','${schema}.register_whatsapp_acceptance(uuid,uuid,text,text)','EXECUTE') AS allowed`))[0].allowed,true);
 }finally{await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await sql.end();}
});
