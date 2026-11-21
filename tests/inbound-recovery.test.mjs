import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const code = ts.transpileModule(readFileSync(new URL('../src/lib/inbound-recovery.server.ts', import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
test('worker resumes persisted jobs without webhook, isolates failures, schedules one nonoverlapping loop', async () => {
  const calls = [], timers = [], errors = [];
  const module = { exports: {} };
  const rows = ['a','b'].map(id => ({ id, business_id:'owner', customer_phone:'6011', text:'hello', external_message_id:id, chat_id:'chat' }));
  vm.runInNewContext(code, { module, exports:module.exports, Symbol, console:{ error: (...args) => errors.push(args) },
    setTimeout(fn) { timers.push(fn); return { unref() {} }; },
    require(name) { return name.includes('client.server') ? { supabaseAdmin:{ rpc:async () => ({ data:rows, error:null }) } } : {
      ingestCustomerMessage:async input => { calls.push(input); if (input.messageId==='a') throw Error('crashed'); }
    }; }
  });
  const result = await module.exports.recoverInboundMessages();
  assert.equal(result.scanned,2); assert.equal(result.failed,1);
  assert.equal(calls[1].resumeChatId,'chat'); assert.equal(calls[1].allowDryRun,undefined);
  module.exports.startInboundRecovery(); module.exports.startInboundRecovery();
  assert.equal(timers.length,1);
  await timers.shift()(); assert.equal(timers.length,1);
  assert.equal(errors.length,2);
});
