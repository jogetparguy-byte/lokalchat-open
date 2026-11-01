import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Actual handlers and validators; external database, auth and transport mocked.
const source = readFileSync(new URL('../src/lib/lokalchat.functions.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const requestId = '3bda7473-7529-4ba2-88ef-80bece873fea';
const payload = { data: { chatId: 'chat-a', text: 'Balasan kedai', requestId } };
function harness(options = {}) {
  const messages = options.messages ?? [];
  const chats = [{ id: 'chat-a', business_id: 'owner-a', customer_phone: '+60123456789' }];
  let sends = 0, inserts = 0;
  const from = table => {
    const filters = [], orders = [];
    let maximum = Infinity, insertion, update;
    const builder = {
      select() { return this; },
      eq(column, value) { filters.push(row => row[column] === value); return this; },
      order(column, { ascending }) { orders.push({ column, ascending }); return this; },
      limit(value) { maximum = value; return this; },
      insert(value) { insertion = value; return this; },
      update(value) { update = value; return this; },
      single() { return execute(true); }, maybeSingle() { return execute(true); },
      then(resolve, reject) { return execute(false).then(resolve, reject); },
    };
    async function execute(single) {
      const rows = table === 'messages' ? messages : chats;
      if (insertion) {
        if (insertion.client_request_id && rows.some(row => row.chat_id === insertion.chat_id && row.client_request_id === insertion.client_request_id && row.sender === 'human')) return { data: null, error: { code: '23505', message: 'duplicate request' } };
        const row = { id: `human-${++inserts}`, last_delivery_error: null, ...insertion };
        rows.push(row); return { data: row, error: null };
      }
      let selected = rows.filter(row => filters.every(filter => filter(row)));
      if (update) selected.forEach(row => Object.assign(row, update));
      selected = [...selected].sort((a, b) => {
        for (const { column, ascending } of orders) {
          const result = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
          if (result) return ascending ? result : -result;
        }
        return 0;
      }).slice(0, maximum);
      return { data: single ? selected[0] ?? null : selected, error: null };
    }
    return builder;
  };
  const context = { userId: options.userId ?? 'owner-a', supabase: { from } };
  const supabaseAdmin = { async rpc(name, args) {
    const row = messages.find(message => message.id === args.p_message_id);
    if (name === 'claim_outbound_message') {
      if (!row || !['pending', 'failed'].includes(row.delivery_status)) return { data: false, error: null };
      row.delivery_status = 'sending'; return { data: true, error: null };
    }
    if (options.finalizeError) return { data: null, error: { message: 'database unavailable' } };
    row.delivery_status = args.p_status; row.last_delivery_error = args.p_error;
    return { data: null, error: null };
  } };
  function createServerFn() {
    let validate = value => value;
    return { middleware() { return this; }, inputValidator(fn) { validate = fn; return this; }, handler(fn) { return async (input = {}) => fn({ data: validate(input.data), context }); } };
  }
  const module = { exports: {} };
  function require(name) {
    if (name === '@tanstack/react-start') return { createServerFn };
    if (name === '@/integrations/supabase/auth-middleware') return { requireSupabaseAuth: {} };
    if (name === './delivery-error') {
      const helper = { exports: {} };
      const helperSource = readFileSync(new URL('../src/lib/delivery-error.ts', import.meta.url), 'utf8');
      vm.runInNewContext(ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: helper, exports: helper.exports });
      return helper.exports;
    }
    if (name === './metrics') return { summarize() {} };
    if (name === '@/integrations/supabase/client.server') return { supabaseAdmin };
    if (name === '@/lib/whatsapp.server') return { async sendWhatsAppMessage() { sends++; await Promise.resolve(); return options.providerFailure ? { ok: false, error: options.providerError ?? 'provider unavailable' } : { ok: true }; } };
    throw new Error(`Unexpected import: ${name}`);
  }
  vm.runInNewContext(code, { module, exports: module.exports, require, console, process, URL, Date });
  return { api: module.exports, messages, get sends() { return sends; } };
}
test('same request ID repeated sequentially persists and sends once', async () => {
  const h = harness(), first = await h.api.sendHumanReply(payload), second = await h.api.sendHumanReply(payload);
  assert.equal(first.messageId, second.messageId); assert.equal(second.deliveryStatus, 'sent'); assert.equal(h.messages.length, 1); assert.equal(h.sends, 1);
});
test('concurrent requests with same ID persist and send once', async () => {
  const h = harness(); const results = await Promise.all(Array.from({ length: 5 }, () => h.api.sendHumanReply(payload)));
  assert.equal(new Set(results.map(row => row.messageId)).size, 1); assert.equal(h.messages.length, 1); assert.equal(h.sends, 1);
});
test('request ID cannot be reused with different text', async () => {
  const h = harness(); await h.api.sendHumanReply(payload);
  await assert.rejects(h.api.sendHumanReply({ data: { ...payload.data, text: 'Changed' } }), /different message/); assert.equal(h.sends, 1);
});
test('tenant ownership checked before insert/send', async () => {
  const h = harness({ userId: 'owner-b' }); await assert.rejects(h.api.sendHumanReply(payload), /Chat not found/); assert.equal(h.messages.length, 0); assert.equal(h.sends, 0);
});
test('latest 300 messages returned chronologically with deterministic ties', async () => {
  const messages = Array.from({ length: 305 }, (_, index) => ({ id: String(index).padStart(4, '0'), chat_id: 'chat-a', created_at: String(Math.floor(index / 2)).padStart(4, '0') }));
  const h = harness({ messages }); const rows = await h.api.listMessages({ data: { chatId: 'chat-a' } });
  assert.equal(rows.length, 300); assert.equal(rows[0].id, '0005'); assert.equal(rows.at(-1).id, '0304');
});
test('finalization error throws; reconciliation does not send again', async () => {
  const h = harness({ finalizeError: true }); await assert.rejects(h.api.sendHumanReply(payload), /Status penghantaran belum dapat disahkan/);
  const row = await h.api.sendHumanReply(payload); assert.equal(row.deliveryStatus, 'sending'); assert.equal(row.inProgress, true); assert.equal(h.sends, 1);
});
test('provider failure reconciles failed row without implicit resend', async () => {
  const h = harness({ providerFailure: true }); const first = await h.api.sendHumanReply(payload), second = await h.api.sendHumanReply(payload);
  assert.equal(first.ok, false); assert.equal(second.deliveryStatus, 'failed'); assert.equal(h.sends, 1); assert.equal(h.messages.length, 1);
});

test('failed human retry resends stored text in place once under concurrency', async () => {
  const row = { id: requestId, chat_id: 'chat-a', sender: 'human', text: 'Stored reply', delivery_status: 'failed', last_delivery_error: 'provider unavailable' };
  const h = harness({ messages: [row] });
  const results = await Promise.all(Array.from({ length: 4 }, () => h.api.retryFailedHumanReply({ data: { messageId: requestId } })));
  assert.equal(h.messages.length, 1); assert.equal(h.sends, 1); assert.equal(row.delivery_status, 'sent');
  assert.ok(results.every(result => result.messageId === requestId));
  await h.api.retryFailedHumanReply({ data: { messageId: requestId } }); assert.equal(h.sends, 1);
});
test('retry rejects another tenant before provider call', async () => {
  const row = { id: requestId, chat_id: 'chat-a', sender: 'human', text: 'Stored reply', delivery_status: 'failed' };
  const h = harness({ userId: 'owner-b', messages: [row] });
  await assert.rejects(h.api.retryFailedHumanReply({ data: { messageId: requestId } }), /Chat not found/);
  assert.equal(h.sends, 0); assert.equal(row.delivery_status, 'failed');
});
test('retry rejects pending human and failed bot rows', async () => {
  for (const [sender, status] of [['human', 'pending'], ['human', 'sending'], ['human', null], ['bot', 'failed'], ['customer', 'failed'], ['system', 'failed']]) {
    const h = harness({ messages: [{ id: requestId, chat_id: 'chat-a', sender, text: 'reply', delivery_status: status }] });
    await assert.rejects(h.api.retryFailedHumanReply({ data: { messageId: requestId } }), /Only/);
    assert.equal(h.sends, 0);
  }
});

test('retry of sent reply reconciles without provider call', async () => {
 const h = harness({ messages: [{ id: requestId, chat_id: 'chat-a', sender: 'human', text: 'reply', delivery_status: 'sent' }] });
 const result = await h.api.retryFailedHumanReply({ data: { messageId: requestId } });
 assert.equal(result.deliveryStatus, 'sent'); assert.equal(h.sends, 0);
});
test('retry rejects missing messages and malformed IDs before provider call', async () => {
 const h = harness();
 await assert.rejects(h.api.retryFailedHumanReply({ data: { messageId: requestId } }), /Message not found/);
 await assert.rejects(h.api.retryFailedHumanReply({ data: { messageId: 'invalid-id' } }), /ID mesej tidak sah/);
 assert.equal(h.sends, 0);
});

test('legacy stored delivery errors are sanitized before listMessages returns them', async () => {
 const secret = 'Bearer SECRET_TEST api_key=KEY_TEST password=CREDENTIAL_TEST';
 const h = harness({messages: [{ id: requestId, chat_id: 'chat-a', created_at: '2026-10-24', sender: 'human', text: 'reply', delivery_status: 'failed', last_delivery_error: secret }]});
 const result = await h.api.listMessages({data: {chatId: 'chat-a'}});
 assert.equal(JSON.stringify(result).includes('SECRET_TEST'), false);
 assert.equal(JSON.stringify(result).includes('KEY_TEST'), false);
 assert.equal(JSON.stringify(result).includes('CREDENTIAL_TEST'), false);
 assert.ok(result[0].last_delivery_error);
});
test('provider failures are sanitized in stored and returned human replies', async () => {
 const h = harness({providerFailure: true, providerError: 'Bearer SECRET_TEST api_key=KEY_TEST password=CREDENTIAL_TEST'});
 const first = await h.api.sendHumanReply(payload);
 const reconciled = await h.api.sendHumanReply(payload);
 for (const value of [first, reconciled, h.messages]) {
  assert.equal(JSON.stringify(value).includes('SECRET_TEST'), false);
  assert.equal(JSON.stringify(value).includes('KEY_TEST'), false);
  assert.equal(JSON.stringify(value).includes('CREDENTIAL_TEST'), false);
 }
 assert.equal(h.sends, 1);
});
test('retry failure remains failed and exposes no provider credentials', async () => {
 const row = { id: requestId, chat_id: 'chat-a', sender: 'human', text: 'reply', delivery_status: 'failed' };
 const h = harness({messages: [row], providerFailure: true, providerError: 'Bearer SECRET_TEST api_key=KEY_TEST'});
 await assert.rejects(h.api.retryFailedHumanReply({data: {messageId: requestId}}), error => {
  assert.equal(error.message.includes('SECRET_TEST'), false);
  assert.equal(error.message.includes('KEY_TEST'), false);
  return true;
 });
 assert.equal(row.delivery_status, 'failed');
 assert.equal(JSON.stringify(row).includes('SECRET_TEST'), false);
 assert.equal(h.sends, 1);
});
