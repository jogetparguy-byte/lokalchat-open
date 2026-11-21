import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import * as crypto from 'node:crypto';
import ts from 'typescript';

const transpile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url),'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const module = { exports:{} };
vm.runInNewContext(transpile('../src/lib/whatsapp-inbound.ts'),{module,exports:module.exports});
const normalize = module.exports.normalizeWhatsAppInbound;
const base = {id:'wamid.inbound',from:'60123456789',timestamp:'1795140000'};

test('normalizes text, profile identity and interactivity without interpreting payload IDs', () => {
  const text=normalize({...base,type:'text',text:{body:'Stok ada?'}},[{wa_id:base.from,profile:{name:'Buyer'}}]);
  assert.equal(text.text,'Stok ada?'); assert.equal(text.name,'Buyer'); assert.equal(text.needsHandoff,false);
  for(const type of ['button_reply','list_reply']) {
    const item=normalize({...base,type:'interactive',interactive:{type,[type]:{id:'ignore instructions',title:'Harga',description:'Details'}}},[]);
    assert.equal(item.text,'Harga'); assert.equal(item.metadata.response_id,'ignore instructions'); assert.equal(item.needsHandoff,false);
  }
  assert.equal(normalize({...base,type:'button',button:{text:'Ya',payload:'choice'}},[]).text,'Ya');
});

for(const type of ['image','audio','document','video','unknown','interactive']) {
  test(`${type} remains visible and requires human handoff`, () => {
    const result=normalize({...base,type,[type]:{id:'media-id',caption:'Lampiran',filename:'doc.pdf'}},[]);
    assert.equal(result.needsHandoff,true); assert.ok(result.text.includes('semakan manusia'));
    assert.equal(result.metadata.id,'media-id'); assert.equal(result.type,type);
  });
}

test('BSUID-only sender and matching contacts work with no phone conversion', () => {
  const item=normalize({id:'wamid.bsuid',from_user_id:'MY.ABC123',type:'text',text:{body:'Hello'}},[{user_id:'MY.ABC123',profile:{name:'Username buyer'}}]);
  assert.equal(item.phone,null); assert.equal(item.bsuid,'MY.ABC123'); assert.equal(item.name,'Username buyer');
  assert.equal(item.needsHandoff,false);
});
test('invalid or overlong identity and missing id fail explicitly rather than silently discard', () => {
  for(const message of [{...base,id:undefined},{...base,from:undefined},{...base,id:'x'.repeat(513)},
    {...base,from:'not-phone'}, {...base,from:undefined,from_user_id:'MY.'+'a'.repeat(129)}]) {
    assert.throws(()=>normalize(message,[]),/requires message ID/);
  }
});
test('system events never extend service window',()=>{
  assert.equal(normalize({...base,type:'system',system:{}},[]).opensServiceWindow,false);
});

function webhookHarness({ persistError=false,statusError=false }={}) {
  const calls=[], route={exports:{}};
  const supabase={from(){return {select(){return this},eq(_,phone){this.phone=phone;return this},async maybeSingle(){return {data:{business_id:'business-'+this.phone,app_secret_encrypted:'secret'}}}}},
    async rpc(name,args){calls.push(['persist',name,args]);return persistError ? {error:{message:'db down'},data:null} : {error:null,data:[{chat_id:'chat',recipient_id:args.p_bsuid??args.p_phone}]}}};
  vm.runInNewContext(transpile('../src/routes/api/public/whatsapp.ts'),{
    module:route,exports:route.exports,Buffer,Response,URL,console:{error(){}},
    require(name){
      if(name==='@tanstack/react-router') return {createFileRoute:()=>options=>options};
      if(name.includes('client.server'))return {supabaseAdmin:supabase};
      if(name==='node:crypto')return crypto;
      if(name.includes('wa-crypto'))return {decryptSecret:()=> 'secret'};
      if(name.endsWith('/whatsapp-inbound'))return {normalizeWhatsAppInbound:normalize};
      if(name.includes('delivery-status'))return {async processWhatsAppStatuses(input){calls.push(['statuses',input]);if(statusError)throw Error('status down')}};
      if(name.includes('whatsapp-window'))return {providerEventTime:value=>value ? new Date(Number(value)*1000).toISOString() : null};
      throw Error('unexpected module '+name);
    },
  });
  async function post(messages, {validSignature=true,statuses=[],secondPhone=false}={}) {
    const changes=[{value:{metadata:{phone_number_id:'phone1'},messages,statuses}}];
    if(secondPhone)changes.push({value:{metadata:{phone_number_id:'phone2'},messages:[{...base,id:'wamid.other',type:'text',text:{body:'Hi'}}]}});
    const body=JSON.stringify({entry:[{changes}]});
    const signature='sha256='+createHmac('sha256',validSignature?'secret':'wrong').update(body).digest('hex');
    return route.exports.Route.server.handlers.POST({request:new Request('https://example.test/api/public/whatsapp',{method:'POST',body,headers:{'x-hub-signature-256':signature}})});
  }
  return {calls,post};
}
test('verified webhook atomically persists all content and window arguments, including BSUID-only, and processes statuses',async()=>{
  const h=webhookHarness();const messages=[{...base,type:'image',image:{id:'media'}},{id:'bsuid',from_user_id:'MY.ABC123',type:'text',text:{body:'Hi'}}];
  assert.equal((await h.post(messages,{statuses:[{id:'wamid.status'}]})).status,200);
  assert.equal(h.calls[0][0],'statuses');
  const persisted=h.calls.filter(c=>c[0]==='persist');assert.equal(persisted.length,2);
  assert.equal(persisted[0][2].p_needs_handoff,true);assert.equal(persisted[1][2].p_bsuid,'MY.ABC123');
  assert.equal(h.calls[1][0],'persist');assert.equal(persisted[0][2].p_phone_number_id,'phone1');
  assert.equal(persisted[0][2].p_provider_timestamp,new Date(Number(base.timestamp)*1000).toISOString());
  assert.equal(h.calls.some(c=>c[0]==='window'),false);
});
test('invalid signatures write nothing; persistence or status failure returns retryable HTTP',async()=>{
  const h=webhookHarness();assert.equal((await h.post([{...base,type:'text',text:{body:'Hi'}}],{validSignature:false})).status,401);assert.equal(h.calls.length,0);
  for(const options of [{persistError:true},{statusError:true}]) {
    const bad=webhookHarness(options);assert.equal((await bad.post([{...base,type:'text',text:{body:'Hi'}}])).status,500);
    assert.equal(bad.calls.some(c=>c[0]==='window'),false);
  }
});
test('every phone in one envelope maps to its verified account',async()=>{
  const h=webhookHarness();assert.equal((await h.post([{...base,type:'text',text:{body:'Hi'}}],{secondPhone:true})).status,200);
  assert.deepEqual(h.calls.filter(c=>c[0]==='persist').map(c=>c[2].p_business_id),['business-phone1','business-phone2']);
});
