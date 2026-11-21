import test from 'node:test';
import assert from 'node:assert/strict';
import { recordWhatsAppAcceptance, processWhatsAppStatuses, recordWhatsAppReportAcceptance } from '../src/lib/delivery-status.server.ts';

test('acceptance records provider id, business and phone atomically', async () => {
  const calls=[]; const db={rpc:async(...args)=>{calls.push(args);return {error:null};}};
  assert.equal(await recordWhatsAppAcceptance(db,'owner','message',{providerMessageId:'wamid.1',providerPhoneNumberId:'phone'}),true);
  assert.deepEqual(calls,[['register_whatsapp_acceptance',{p_business_id:'owner',p_message_id:'message',p_phone_number_id:'phone',p_provider_message_id:'wamid.1'}]]);
  assert.equal(await recordWhatsAppAcceptance(db,'owner','message',{}),false);
  assert.equal(calls.length,1);
  await assert.rejects(recordWhatsAppAcceptance(db,'owner','message',{providerMessageId:'wamid.1'}),/phone identity/);
});
test('accepted persistence errors never report retryable send failure', async () => {
  await assert.rejects(recordWhatsAppAcceptance({rpc:async()=>({error:{message:'secret'}})},'owner','message',{providerMessageId:'wamid.1',providerPhoneNumberId:'phone'}),/jangan hantar semula/);
});
test('webhook validates statuses and persists only numeric error codes', async () => {
  const calls=[];const db={rpc:async(...a)=>{calls.push(a);return{error:null};}};
  await processWhatsAppStatuses({supabase:db,userId:'owner',phoneNumberId:'phone',statuses:[null,{id:'a',status:'unknown',timestamp:'123'},
    {id:'b',status:'read',timestamp:'bad'},{id:'wamid.1',status:'failed',timestamp:'1760000000',errors:[{code:131026,message:'token private'},{code:'secret'}]}]});
  assert.equal(calls.length,1);assert.equal(calls[0][0],'record_whatsapp_delivery_status');
  assert.equal(calls[0][1].p_business_id,'owner');assert.match(calls[0][1].p_error,/131026/);assert.doesNotMatch(calls[0][1].p_error,/secret|private/);
});
test('status persistence error requests provider retry',async()=>{
 await assert.rejects(processWhatsAppStatuses({supabase:{rpc:async()=>({error:{}})},userId:'o',phoneNumberId:'p',statuses:[{id:'w',status:'read',timestamp:'1760000000'}]}),/persist/);
});
test('weekly report acceptance uses same provider reconciliation domain',async()=>{
 let call;await recordWhatsAppReportAcceptance({rpc:async(...a)=>{call=a;return{error:null};}},'owner',{providerMessageId:'w',providerPhoneNumberId:'p'});
 assert.equal(call[0],'register_whatsapp_report_acceptance');assert.deepEqual(call[1],{p_business_id:'owner',p_phone_number_id:'p',p_provider_message_id:'w'});
});
