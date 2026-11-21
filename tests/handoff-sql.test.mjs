import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
const envFile=process.env.LOKALCHAT_RECOVERY_DB_ENV;
test('handoff SQL: atomic tasks, tenant CAS, durable notices, bounded retry and escalation',{skip:!envFile},async()=>{
 const env=parseEnv(readFileSync(envFile,'utf8'));assert.ok(['localhost','127.0.0.1'].includes(new URL(env.DB_URL).hostname));
 const sql=postgres(env.DB_URL,{max:1,onnotice(){}}),schema=`handoff_${Date.now()}`;
 const owner='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',chat='33333333-3333-3333-3333-333333333333';
 const q=(statement,args=[])=>sql.unsafe(statement.replaceAll('TEST.',schema+'.'),args);
 try{
  await q(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO authenticated,service_role;
  CREATE FUNCTION TEST.auth_uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  CREATE TABLE TEST.profiles(id uuid PRIMARY KEY,owner_whatsapp text);
  CREATE TABLE TEST.chats(id uuid PRIMARY KEY,business_id uuid,is_bot_active boolean DEFAULT true,bot_generation integer DEFAULT 0);
  CREATE TABLE TEST.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chat_id uuid,sender text,delivery_status text,sent_at timestamptz,last_delivery_error text);
  CREATE TABLE TEST.handoff_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chat_id uuid,business_id uuid);
  INSERT INTO TEST.profiles VALUES('${owner}',NULL),('${other}',NULL); INSERT INTO TEST.chats(id,business_id) VALUES('${chat}','${owner}');`);
  for(const file of ['20261120032537_whatsapp_delivery_tracking.sql','20261120035356_handoff_tasks_notifications.sql']) {
   const text=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8').replaceAll('public.',schema+'.').replaceAll('auth.uid()',schema+'.auth_uid()');await sql.unsafe(text);
  }
  await q(`UPDATE TEST.chats SET is_bot_active=false,bot_generation=1 WHERE id='${chat}'`);
  await q(`UPDATE TEST.chats SET is_bot_active=false WHERE id='${chat}';INSERT INTO TEST.messages(chat_id,sender)VALUES('${chat}','customer');`);
  let tasks=await q('SELECT * FROM TEST.handoff_tasks');assert.equal(tasks.length,1);
  assert.equal((await q('SELECT count(*)::int n FROM TEST.handoff_notifications'))[0].n,1);
  assert.equal((await q('SELECT count(*)::int n FROM TEST.handoff_events'))[0].n,1);
  const id=tasks[0].id;
  await q(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${other}',false)`);
  assert.equal((await q('SELECT * FROM TEST.handoff_tasks')).length,0);
  assert.equal((await q('SELECT TEST.transition_handoff_task($1,\'pending\',\'accepted\') changed',[id]))[0].changed,false);
  await q(`SELECT set_config('request.jwt.claim.sub','${owner}',false)`);
  assert.equal((await q('SELECT * FROM TEST.handoff_tasks')).length,1);
  await assert.rejects(q(`UPDATE TEST.handoff_tasks SET status='resolved' WHERE id='${id}'`),/permission denied/);
  assert.equal((await q('SELECT TEST.transition_handoff_task($1,\'pending\',\'accepted\') changed',[id]))[0].changed,true);
  assert.equal((await q('SELECT TEST.transition_handoff_task($1,\'pending\',\'accepted\') changed',[id]))[0].changed,false);
  assert.equal((await q('SELECT TEST.transition_handoff_task($1,\'accepted\',\'resolved\') changed',[id]))[0].changed,true);
  await q('RESET ROLE');
  await q(`INSERT INTO TEST.messages(chat_id,sender)VALUES('${chat}','customer')`);
  tasks=await q("SELECT * FROM TEST.handoff_tasks WHERE status='pending'");assert.equal(tasks.length,1);assert.notEqual(tasks[0].id,id);
  const pending=tasks[0].id;
  let claims=await q('SELECT * FROM TEST.claim_handoff_notifications()');assert.equal(claims.length,1);let notice=claims[0];
  assert.equal((await q('SELECT * FROM TEST.claim_handoff_notifications()')).length,0);
  assert.equal((await q('SELECT TEST.finish_handoff_notification($1,$2,\'published\') changed',[notice.id,other]))[0].changed,false);
  assert.equal((await q('SELECT TEST.finish_handoff_notification($1,$2,\'retry\',\'temporary\') changed',[notice.id,notice.lease_token]))[0].changed,true);
  assert.equal((await q('SELECT * FROM TEST.claim_handoff_notifications()')).length,0);
  for(let attempt=2;attempt<=5;attempt++){
   await q('UPDATE TEST.handoff_notifications SET next_attempt_at=now()-interval \'1 second\' WHERE id=$1',[notice.id]);
   notice=(await q('SELECT * FROM TEST.claim_handoff_notifications()'))[0];assert.equal(notice.attempts,attempt);
   await q('SELECT TEST.finish_handoff_notification($1,$2,\'retry\',\'temporary\')',[notice.id,notice.lease_token]);
  }
  assert.equal((await q('SELECT status FROM TEST.handoff_notifications WHERE id=$1',[notice.id]))[0].status,'failed');
  await q('UPDATE TEST.handoff_tasks SET due_at=now()+interval \'1 second\' WHERE id=$1',[pending]);
  await q('SELECT * FROM TEST.claim_handoff_notifications()');assert.equal((await q("SELECT * FROM TEST.handoff_notifications WHERE stage='escalation'")).length,0);
  await q('UPDATE TEST.handoff_tasks SET due_at=now() WHERE id=$1',[pending]);
  const escalation=(await q('SELECT * FROM TEST.claim_handoff_notifications()'))[0];assert.equal(escalation.stage,'escalation');
  await q('SELECT * FROM TEST.claim_handoff_notifications()');assert.equal((await q("SELECT * FROM TEST.handoff_notifications WHERE stage='escalation'")).length,1);
  await q('UPDATE TEST.handoff_notifications SET started_at=now()-interval \'6 minutes\' WHERE id=$1',[escalation.id]);
  assert.equal((await q('SELECT * FROM TEST.claim_handoff_notifications()')).length,0);assert.equal((await q('SELECT status FROM TEST.handoff_notifications WHERE id=$1',[escalation.id]))[0].status,'uncertain');
  await q(`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false)`);
  assert.equal((await q('SELECT TEST.retry_handoff_notification($1) changed',[escalation.id]))[0].changed,true);
  await q('RESET ROLE');let report=(await q('SELECT * FROM TEST.claim_handoff_notifications()'))[0];
  await q('SELECT TEST.record_whatsapp_delivery_status($1,\'phone\',\'wamid.notice\',\'failed\',now(),\'Meta gagal menghantar.\')',[owner]);
  await q('SELECT TEST.finish_handoff_notification($1,$2,\'accepted\',NULL,\'wamid.notice\',\'phone\')',[report.id,report.lease_token]);
  assert.equal((await q('SELECT provider_delivery_status FROM TEST.handoff_notifications WHERE id=$1',[report.id]))[0].provider_delivery_status,'failed');
  await q('SELECT TEST.record_whatsapp_delivery_status($1,\'phone\',\'wamid.notice\',\'read\',now(),NULL)',[owner]);
  assert.equal((await q('SELECT provider_delivery_status FROM TEST.handoff_notifications WHERE id=$1',[report.id]))[0].provider_delivery_status,'read');
  // A late receipt for the previous attempt cannot consume the new attempt's lease.
  await q("UPDATE TEST.handoff_notifications SET status='failed' WHERE id=$1",[report.id]);
  await q(`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false)`);
  await q('SELECT TEST.retry_handoff_notification($1)',[report.id]);await q('RESET ROLE');
  const retried=(await q('SELECT * FROM TEST.claim_handoff_notifications()'))[0];
  await q('SELECT TEST.record_whatsapp_delivery_status($1,\'phone\',\'wamid.notice\',\'read\',now(),NULL)',[owner]);
  assert.equal((await q('SELECT status FROM TEST.handoff_notifications WHERE id=$1',[report.id]))[0].status,'sending');
  assert.equal((await q('SELECT TEST.finish_handoff_notification($1,$2,\'accepted\',NULL,\'wamid.new\',\'phone\') changed',[report.id,retried.lease_token]))[0].changed,true);
  assert.equal((await q(`SELECT has_function_privilege('authenticated','${schema}.claim_handoff_notifications()','EXECUTE') allowed`))[0].allowed,false);
 }finally{await q('RESET ROLE');await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await sql.end();}
});
