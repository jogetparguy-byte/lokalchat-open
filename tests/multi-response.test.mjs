import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/agent.server.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const texts = ['Buka kotak dahulu.', 'Pasang bateri mengikut panduan.', 'Tekan butang untuk hidupkan peranti.'];
const tool = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const response = messages => ({ role: 'assistant', content: null, tool_calls: [tool('respond_to_customer', { messages })] });
const input = { businessId: 'owner-a', customerPhone: '60123456789', text: 'Bagaimana guna peranti?', messageId: 'wa-in-1' };

function harness(options = {}) {
  const rows = [], requests = [], sends = [], batches = [], chats = [{ id: 'chat-a', business_id: 'owner-a', is_bot_active: true, bot_generation: 0 }];
  let serial = 0, failures = 0;
  const from = table => {
    const filters = [], orders = [];
    let insertion, patch, upsert, maximum = Infinity;
    const builder = {
      select() { return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      ilike() { return this; },
      order(key, { ascending }) { orders.push({ key, ascending }); return this; },
      limit(value) { maximum = value; return this; },
      insert(value) { insertion = value; return this; },
      update(value) { patch = value; return this; },
      upsert(value) { upsert = value; return this; },
      single() { return execute(true); },
      maybeSingle() { return execute(true); },
      then(resolve, reject) { return execute(false).then(resolve, reject); },
    };
    async function execute(single) {
      if (table === 'knowledge_base') return { data: [{ content: 'Versi ini RM100. Promosi bulan ini diskaun 30%.' }], error: null };
      const collection = table === 'chats' ? chats : rows;
      if (upsert) Object.assign(chats[0], upsert);
      if (insertion) {
        const batch = Array.isArray(insertion) ? Array.from(insertion) : [insertion];
        if (options.insertFailure && batch[0].sender === 'bot') return { data: null, error: { message: 'insert failed' } };
        if (batch.some(row => collection.some(existing => existing.chat_id === row.chat_id && (
          (row.external_message_id && row.external_message_id === existing.external_message_id) ||
          (row.reply_to_external_message_id && row.reply_to_external_message_id === existing.reply_to_external_message_id && row.reply_sequence === existing.reply_sequence)
        )))) return { data: null, error: { code: '23505', message: 'duplicate' } };
        const inserted = batch.map(row => ({ id: `message-${++serial}`, delivery_status: null, reply_sequence: 0, created_at: new Date().toISOString(), ...row }));
        collection.push(...inserted);
        if (batch[0].sender === 'bot') batches.push(inserted);
        return { data: single ? inserted[0] : inserted, error: null };
      }
      let selected = collection.filter(row => filters.every(fn => fn(row)));
      if (patch) selected.forEach(row => Object.assign(row, patch));
      selected = [...selected].sort((a, b) => {
        for (const { key, ascending } of orders) {
          const cmp = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
          if (cmp) return ascending ? cmp : -cmp;
        }
        return 0;
      }).slice(0, maximum);
      return { data: single ? selected[0] ?? null : selected, error: null };
    }
    return builder;
  };
  const admin = {
    from,
    auth: { admin: { async getUserById() { return { data: { user: { user_metadata: {} } }, error: null }; } } },
    async rpc(name, args) {
      if (name === 'register_whatsapp_acceptance') {
        const row=rows.find(row=>row.id===args.p_message_id);
        row.delivery_status=options.earlyProviderFailure?'failed':'sent';
        row.provider_message_id=args.p_provider_message_id;
        row.provider_delivery_status=options.earlyProviderFailure?'failed':'accepted';
        return { data:null,error:null };
      }
      if (name === 'load_chat_turn_history') {
        return { data: rows.filter(row => row.chat_id === args.p_chat_id && (
          (row.sender === 'customer' && (row.processing_status === 'done' || row.external_message_id === args.p_external_message_id)) ||
          (['bot','human'].includes(row.sender) && row.delivery_status === 'sent')
        )).map(row => ({ sender: row.sender, text: row.text })), error: null };
      }
      if (name === 'handoff_chat') {
        if (!chats[0].is_bot_active || chats[0].bot_generation !== args.p_generation) return { data: null, error: null };
        chats[0].is_bot_active = false; chats[0].bot_generation++;
        return { data: chats[0].bot_generation, error: null };
      }
      if (name === 'claim_bot_reply') {
        const row = rows.find(row => row.id === args.p_message_id);
        if (options.onClaim) await options.onClaim({ chats, rows });
        const inbound = rows.find(item => item.external_message_id === row.reply_to_external_message_id);
        if (inbound?.processing_token !== args.p_token) return { data:'busy',error:null };
        if (row.delivery_status === 'sent') return { data: 'sent', error: null };
        if (row.delivery_status === 'cancelled' || row.bot_generation !== chats[0].bot_generation || (!chats[0].is_bot_active && row.bot_reply_kind !== 'handoff')) {
          row.delivery_status = 'cancelled'; return { data: 'cancelled', error: null };
        }
        const result = await admin.rpc('claim_outbound_message', args);
        return { data: result.data ? 'claimed' : 'busy', error: result.error };
      }

      if (name.includes('inbound') || name === 'claim_chat_turn' || name === 'finish_chat_turn') {
        const row = rows.find(row => row.chat_id === args.p_chat_id && row.external_message_id === args.p_external_message_id);
        if (name === 'claim_chat_turn') {
          if (!row || !['pending', 'failed'].includes(row.processing_status)) return { data: false, error: null };
          row.processing_status = 'processing';
          row.processing_token = `lease-${++serial}`;
          return { data: row.processing_token, error: null };
        }
        if (row.processing_token === args.p_token) row.processing_status = args.p_status;
      } else {
        const row = rows.find(row => row.id === args.p_message_id);
        if (name === 'claim_outbound_message') {
          if (options.leasedPart === row.reply_sequence || !['pending', 'failed'].includes(row.delivery_status)) return { data: false, error: null };
          row.delivery_status = 'sending';
          return { data: true, error: null };
        }
        if (options.finalizeFailure && args.p_status === 'sent') return { data: null, error: { message: 'finalize failed' } };
        row.delivery_status = args.p_status;
      }
      return { data: null, error: null };
    },
  };
  const module = { exports: {} };
  const imports = {
    '@/integrations/supabase/client.server': { supabaseAdmin: admin },
    './preferences': { accountPreferences: () => ({ replyLanguage: 'auto' }), replyInstruction: () => 'Reply in customer language.' },
    './embeddings.server': { createEmbedding: async () => null },
    './whatsapp.server': { async sendWhatsAppMessage(phone, text, owner, flags) {
      sends.push({ phone, text, owner, flags });
      if (options.onSend) await options.onSend({ chats, rows, sends });
      if (options.terminalAt === text) return { ok: false, error: 'Tetingkap servis tamat.', retryable: false };
      if (options.failOnceAt === text && failures++ === 0) return { ok: false, error: 'temporary provider failure' };
      return options.withProviderId ? { ok: true, providerMessageId: `wamid.${sends.length}`, providerPhoneNumberId:'phone-owner-a' } : { ok: true };
    } },
    './platform-key.server': { async getActiveLlmConfig(owner) {
      assert.equal(owner, 'owner-a');
      return { baseUrl: 'https://fixture.test', model: 'owner-selected-model', apiKey: 'fixture-key' };
    } },
    './llm-settings': { LLM_PROVIDERS: { fixture: { baseUrl: 'https://fixture.test' } } },
    './unanswered.server': { recordUnansweredQuestion: async () => {} },
  };
  const fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (options.onModel) await options.onModel({ chats, rows });
    const choices = options.choices ?? [response(texts)];
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: choices[Math.min(requests.length - 1, choices.length - 1)] }] }) };
  };
  const loadModule = name => {
    const helperSource = readFileSync(new URL(`../src/lib/${name.slice(2)}.ts`, import.meta.url), 'utf8');
    const helperCode = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const helper = { exports: {} };
    vm.runInNewContext(helperCode, { module: helper, exports: helper.exports, require: resolveImport, console, process, URL, AbortSignal, fetch, Date });
    return helper.exports;
  };
  const resolveImport = name => {
    if (name === 'node:crypto') return { randomUUID: () => 'simulator-id' };
    if (['./agent-prompt.server', './commercial-grounding.server', './delivery-status.server', './delivery-error'].includes(name)) return loadModule(name);
    if (!imports[name]) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: resolveImport, console, process, URL, AbortSignal, fetch, Date });
  return { api: module.exports, rows, sends, requests, batches, chats };
}

test('validates 1–3 distinct messages and rejects malformed response batches', () => {
  const { api } = harness();
  assert.deepEqual(Array.from(api.parseResponseMessages(JSON.stringify({ messages: [' Harga RM100. ', 'Nak bantuan?'] }))), ['Harga RM100.', 'Nak bantuan?']);
  for (const value of [null, [], {}, { messages: [] }, { messages: texts.concat('four') }, { messages: [' '] }, { messages: [3] }, { messages: ['same', 'same'] }, { messages: ['x'.repeat(4097)] }, { messages: ['ok'], extra: true }]) {
    assert.throws(() => api.parseResponseMessages(JSON.stringify(value)));
  }
  assert.throws(() => api.parseResponseMessages('not json'));
});

test('one LLM completion persists an atomic ordered batch and sends separate messages', async () => {
  const h = harness();
  const result = await h.api.ingestCustomerMessage(input);
  assert.equal(result.botReply, texts.join('\n\n'));
  assert.equal(h.requests.length, 1);
  assert.equal(h.batches.length, 1);
  assert.deepEqual(h.batches[0].map(row => row.reply_sequence), [0, 1, 2]);
  assert.equal(new Set(h.batches[0].map(row => row.created_at)).size, 1);
  assert.deepEqual(h.sends.map(row => row.text), texts);
  assert.ok(h.sends.every(row => row.owner === 'owner-a'));
  assert.ok(h.batches[0].every(row => row.delivery_status === 'sent'));
  assert.equal(h.chats[0].last_message, texts[2]);
  await h.api.ingestCustomerMessage(input);
  assert.equal(h.sends.length, 3);
  assert.equal(h.requests.length, 1);
});

test('plain text, including paragraphs and numbered steps, remains one message', async () => {
  const text = '1. Buka kotak.\n\n2. Pasang bateri.';
  const h = harness({ choices: [{ role: 'assistant', content: text }] });
  await h.api.ingestCustomerMessage(input);
  assert.deepEqual(h.sends.map(row => row.text), [text]);
});

test('structured single-message response does not force a promotion or follow-up', async () => {
  const h = harness({ choices: [response(['Buka kotak dahulu.'])] });
  await h.api.ingestCustomerMessage(input);
  assert.deepEqual(h.sends.map(row => row.text), ['Buka kotak dahulu.']);
});

test('retrieves business facts before replying and keeps the owner model on every call', async () => {
  const h = harness({ choices: [
    { role: 'assistant', content: null, tool_calls: [tool('search_faq', { query: 'harga promosi' })] },
    response(texts),
  ] });
  await h.api.ingestCustomerMessage(input);
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(row => row.model === 'owner-selected-model'));
  assert.ok(h.requests[1].messages.some(row => row.role === 'tool' && row.content.includes('RM100')));
});

test('failed middle part blocks later parts; webhook retry resumes without regenerating or resending sent parts', async () => {
  const h = harness({ failOnceAt: texts[1] });
  await assert.rejects(h.api.ingestCustomerMessage(input), /WhatsApp delivery failed/);
  assert.deepEqual(h.sends.map(row => row.text), texts.slice(0, 2));
  assert.deepEqual(h.batches[0].map(row => row.delivery_status), ['sent', 'failed', 'pending']);
  await h.api.ingestCustomerMessage(input);
  assert.deepEqual(h.sends.map(row => row.text), [texts[0], texts[1], texts[1], texts[2]]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.batches.length, 1);
  assert.equal(h.rows.find(row => row.external_message_id).processing_status, 'done');
});

test('an outbound lease blocks later parts and does not mark inbound as complete', async () => {
  const h = harness({ leasedPart: 1 });
  await h.api.ingestCustomerMessage(input);
  assert.deepEqual(h.sends.map(row => row.text), [texts[0]]);
  assert.equal(h.rows.find(row => row.external_message_id).processing_status, 'processing');
});

test('persist failure sends nothing and leaves the inbound retryable', async () => {
  const h = harness({ insertFailure: true });
  await assert.rejects(h.api.ingestCustomerMessage(input), /Failed to save bot reply/);
  assert.equal(h.sends.length, 0);
  assert.equal(h.rows.find(row => row.external_message_id).processing_status, 'failed');
});

test('delivery finalization failure blocks later messages', async () => {
  const h = harness({ finalizeFailure: true });
  await assert.rejects(h.api.ingestCustomerMessage(input), /Failed to finalize outbound/);
  assert.deepEqual(h.sends.map(row => row.text), [texts[0]]);
});

test('invalid batches are repaired before sending; exhausted retries hand off once', async () => {
  const invalid = response(['', 'extra']);
  const repaired = harness({ choices: [invalid, response(['Buka kotak dahulu.'])] });
  await repaired.api.ingestCustomerMessage(input);
  assert.equal(repaired.requests.length, 2);
  assert.deepEqual(repaired.sends.map(row => row.text), ['Buka kotak dahulu.']);
  const exhausted = harness({ choices: [invalid] });
  await exhausted.api.ingestCustomerMessage(input);
  assert.equal(exhausted.requests.length, 4);
  assert.equal(exhausted.sends.length, 1);
  assert.equal(exhausted.chats[0].is_bot_active, false);
  assert.equal(exhausted.rows.filter(row => row.sender === 'system').length, 1);
});

test('handoff overrides sales replies and mixed response/tool calls execute nothing', async () => {
  const handoff = harness({ choices: [{ role: 'assistant', content: null, tool_calls: [tool('trigger_human_handoff', { reason: 'customer_request' })] }] });
  await handoff.api.ingestCustomerMessage(input);
  assert.equal(handoff.sends.length, 1);
  assert.equal(handoff.chats[0].is_bot_active, false);
  const mixed = harness({ choices: [
    { role: 'assistant', content: null, tool_calls: [tool('trigger_human_handoff', { reason: 'customer_request' }), tool('respond_to_customer', { messages: texts })] },
    response(['Apa yg saya boleh bantu?']),
  ] });
  await mixed.api.ingestCustomerMessage(input);
  assert.equal(mixed.chats[0].is_bot_active, true);
  assert.equal(mixed.sends.length, 1);
});

test('dashboard dry run uses the same multipart send path', async () => {
  const h = harness();
  await h.api.ingestCustomerMessage({ ...input, messageId: undefined, allowDryRun: true });
  assert.deepEqual(h.sends.map(row => row.text), texts);
  assert.ok(h.sends.every(row => row.flags.allowDryRun));
});

test('queued webhook survives process loss before AI and duplicate delivery does not run AI', async () => {
  const h = harness();
  await h.api.ingestCustomerMessage({ ...input, enqueueOnly: true });
  await h.api.ingestCustomerMessage({ ...input, enqueueOnly: true });
  assert.equal(h.rows.filter(row => row.sender === 'customer').length, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(h.sends.length, 0);
  await h.api.ingestCustomerMessage({ ...input, resumeChatId: 'chat-a' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.rows.find(row => row.external_message_id).processing_status, 'done');
});

test('recovery reuses saved reply after lease expiry without a new webhook or AI generation', async () => {
  const options = { leasedPart: 0 };
  const h = harness(options);
  await h.api.ingestCustomerMessage(input);
  assert.equal(h.sends.length, 0);
  h.rows.find(row => row.external_message_id).processing_status = 'failed';
  options.leasedPart = undefined;
  // Clear the simulated outbound lease, representing database lease expiry.
  // The persisted reply batch remains in the database across process loss.
  const fresh = h.batches[0];
  assert.equal(fresh.length, 3);
  assert.equal(h.requests.length, 1);
  await h.api.ingestCustomerMessage({ ...input, resumeChatId: 'chat-a' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.sends.length, 3);
  assert.equal(h.rows.find(row => row.external_message_id).processing_status, 'done');
});

test('provider acceptance before status persistence may resend after crash; AI batch stays unique', async () => {
  const options = { finalizeFailure: true };
  const h = harness(options);
  await assert.rejects(h.api.ingestCustomerMessage(input), /finalize outbound/);
  options.finalizeFailure = false;
  h.batches[0][0].delivery_status = 'failed'; // Simulated expired sending lease.
  await h.api.ingestCustomerMessage({ ...input, resumeChatId: 'chat-a' });
  assert.deepEqual(h.sends.map(row => row.text), [texts[0], ...texts]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.batches.length, 1);
});

test('pause during model execution discards the answer and creates no handoff confirmation', async () => {
  const h = harness({ onModel({ chats }) { chats[0].is_bot_active = false; chats[0].bot_generation++; } });
  await h.api.ingestCustomerMessage(input);
  assert.equal(h.sends.length, 0);
  assert.equal(h.batches.length, 0);
  assert.equal(h.rows.find(row => row.external_message_id).processing_status, 'done');
});

test('pause and resume during model execution still invalidate the old answer', async () => {
  const h = harness({ onModel({ chats }) { chats[0].bot_generation += 2; } });
  await h.api.ingestCustomerMessage(input);
  assert.equal(h.sends.length, 0);
  assert.equal(h.batches.length, 0);
});

test('pause between multipart sends cancels all remaining parts', async () => {
  const h = harness({ onSend({ chats }) { chats[0].is_bot_active = false; chats[0].bot_generation++; } });
  await h.api.ingestCustomerMessage(input);
  assert.equal(h.sends.length, 1);
  assert.deepEqual(h.batches[0].map(row => row.delivery_status), ['sent','cancelled','cancelled']);
  assert.equal(h.rows.find(row => row.external_message_id).processing_status, 'done');
});

test('a persisted retry cannot send an old sales reply after pause/resume', async () => {
  const options = { leasedPart: 0 };
  const h = harness(options);
  await h.api.ingestCustomerMessage(input);
  h.chats[0].bot_generation += 2;
  h.rows.find(row => row.external_message_id).processing_status = 'failed';
  options.leasedPart = undefined;
  await h.api.ingestCustomerMessage({ ...input, resumeChatId: 'chat-a' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.sends.length, 0);
  assert.ok(h.batches[0].every(row => row.delivery_status === 'cancelled'));
});

test('stale model handoff cannot pause a chat resumed by the owner', async () => {
  const h = harness({
    choices: [{ role:'assistant',content:null,tool_calls:[tool('trigger_human_handoff',{reason:'customer_request'})] }],
    onModel({ chats }) { chats[0].bot_generation += 2; },
  });
  await h.api.ingestCustomerMessage(input);
  assert.equal(h.chats[0].is_bot_active,true);
  assert.equal(h.sends.length,0);
  assert.equal(h.rows.filter(row => row.sender === 'system').length,0);
});

test('pause after persistence but before outbound authorization cancels the draft', async () => {
  const h = harness({ onClaim({ chats }) { chats[0].is_bot_active=false; chats[0].bot_generation++; } });
  await h.api.ingestCustomerMessage(input);
  assert.equal(h.sends.length,0);
  assert.ok(h.batches[0].every(row=>row.delivery_status==='cancelled'));
});

test('terminal window policy completes inbound and blocks remaining reply parts without recovery retry', async () => {
 const h=harness({terminalAt:texts[1]});
 await h.api.ingestCustomerMessage(input);
 assert.deepEqual(h.sends.map(row=>row.text),texts.slice(0,2));
 assert.equal(h.batches[0][1].delivery_status,'failed');
 assert.equal(h.rows.find(row=>row.sender==='customer').processing_status,'done');
 await h.api.ingestCustomerMessage(input);
 assert.equal(h.sends.length,2);
});

test('accepted provider IDs are bound without overwriting early asynchronous failure or auto-resending', async () => {
 const h=harness({withProviderId:true,earlyProviderFailure:true,choices:[response(['Hello.'])]});
 await h.api.ingestCustomerMessage(input);
 assert.equal(h.sends.length,1);
 assert.equal(h.batches[0][0].provider_message_id,'wamid.1');
 assert.equal(h.batches[0][0].provider_delivery_status,'failed');
 assert.equal(h.batches[0][0].delivery_status,'failed');
 assert.equal(h.rows.find(row=>row.sender==='customer').processing_status,'done');
 await h.api.ingestCustomerMessage(input);
 assert.equal(h.sends.length,1);
});
