import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness(options={}){
 const notices=options.notices??[{id:'notice',task_id:'task',business_id:'owner',channel:'whatsapp',stage:'initial',lease_token:'token'}];
 const finishes=[],sends=[],timers=[];let claimed=false;
 const admin={async rpc(name,args){
  if(name==='claim_handoff_notifications'){if(options.claimError)return{error:{message:'private'}};if(claimed)return{data:[],error:null};claimed=true;return{data:notices,error:null};}
  if(name==='finish_handoff_notification'){finishes.push(args);return options.finishError?{error:{message:'private'}}:{data:true,error:null};}
  throw Error('unknown RPC');
 },from(table){return{select(){return this},eq(){return this},async maybeSingle(){return{data:table==='handoff_tasks'?{status:options.taskStatus??'pending'}:{handoff_notification_channel:options.channel??'whatsapp',owner_whatsapp:options.noPhone?null:'60123456789'},error:null};}};}};
 const module={exports:{}};const code=ts.transpileModule(readFileSync(new URL('../src/lib/handoff-notifications.server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const imports={
  '@/integrations/supabase/client.server':{supabaseAdmin:admin},
  './whatsapp.server':{async sendWhatsAppTemplate(...args){sends.push(args);if(options.sendThrow)throw Error('private');return options.result??{ok:true,providerMessageId:'wamid.notice',providerPhoneNumberId:'provider-phone'};}},
  './whatsapp-window.server':{async approvedWhatsAppTemplate(owner,purpose){assert.equal(owner,'owner');assert.equal(purpose,'handoff');return options.noTemplate?null:{name:'owner_handoff',language:'ms'};}},
  './delivery-error':{safeDeliveryError:()=> 'Ralat penghantaran selamat.'},
 };
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>imports[name],console:{error(){}},Symbol,setTimeout:(fn,delay)=>{timers.push({fn,delay});return{unref(){}};}});
 return{api:module.exports,sends,finishes,timers};
}

test('in-app publication requires no external send and never claims owner acknowledgement',async()=>{
 const h=harness({notices:[{id:'n',task_id:'t',business_id:'owner',channel:'in_app',lease_token:'x'}]});
 await h.api.processHandoffNotifications();assert.equal(h.sends.length,0);assert.equal(h.finishes[0].p_status,'published');
});
test('missing approved handoff template or recipient records explicit terminal failure',async()=>{
 for(const options of [{noTemplate:true},{noPhone:true}]){const h=harness(options);await h.api.processHandoffNotifications();assert.equal(h.sends.length,0);assert.equal(h.finishes[0].p_status,'failed');assert.match(h.finishes[0].p_error,/template handoff/);}
});
test('owner opt-out and acknowledged tasks suppress outstanding external reminders',async()=>{
 for(const options of [{channel:'in_app'},{taskStatus:'accepted'},{taskStatus:'resolved'}]){const h=harness(options);await h.api.processHandoffNotifications();assert.equal(h.sends.length,0);assert.equal(h.finishes[0].p_status,'skipped');}
});
test('provider acceptance retains ID and distinct overdue content without claiming delivered',async()=>{
 const h=harness({notices:[{id:'n',task_id:'t',business_id:'owner',channel:'whatsapp',stage:'escalation',lease_token:'x'}]});await h.api.processHandoffNotifications();
 assert.equal(h.finishes[0].p_status,'accepted');assert.equal(h.finishes[0].p_provider_message_id,'wamid.notice');assert.equal(h.finishes[0].p_phone_number_id,'provider-phone');
 assert.equal(h.sends[0][2],'owner');assert.match(h.sends[0][1].bodyParameters[0],/15 minit/);
 assert.deepEqual(Array.from(h.sends[0][1].bodyParameters),['Tugasan bantuan pelanggan melebihi 15 minit tanpa penerimaan.','t']);
 assert.equal(h.sends[0][1].name,'owner_handoff');assert.equal(h.sends[0][1].language,'ms');
});
test('explicit transient rejection retries; terminal and uncertain outcomes do not blindly resend',async()=>{
 for(const[result,status]of[[{ok:false,status:429,error:'private'},'retry'],[{ok:false,status:503},'retry'],[{ok:false,retryable:false},'failed'],[{ok:false,status:400},'failed'],[{ok:false},'uncertain'],[{ok:true},'uncertain']]){
  const h=harness({result});await h.api.processHandoffNotifications();assert.equal(h.finishes[0].p_status,status);await h.api.processHandoffNotifications();assert.equal(h.sends.length,1);
 }
});
test('unknown side effect or finalization failure leaves leased work for uncertainty recovery',async()=>{
 const h=harness({finishError:true});await h.api.processHandoffNotifications();await h.api.processHandoffNotifications();assert.equal(h.sends.length,1);
 const thrown=harness({sendThrow:true});await thrown.api.processHandoffNotifications();assert.equal(thrown.finishes.length,0);
});
test('one worker per process schedules bounded non-overlapping sweeps',async()=>{
 const h=harness();h.api.startHandoffNotifications();h.api.startHandoffNotifications();assert.equal(h.timers.length,1);assert.equal(h.timers[0].delay,0);await h.timers[0].fn();assert.equal(h.timers[1].delay,15000);
});
