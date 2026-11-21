import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports,
    require(name) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); },
    process: { env: {} }, AbortSignal, Date, Set, console: { error() {}, info() {} }, ...globals });
  return module.exports;
}
const errors = load('../src/lib/delivery-error.ts');

function harness(options = {}) {
  const requests = [], events = [], queries = [];
  const admin = {
    from(table) {
      const filters = {};
      const builder = {
        select() { return this; }, eq(key, value) { filters[key] = value; return this; }, update() { return this; },
        async maybeSingle() {
          queries.push({ table, ...filters });
          if (table === 'whatsapp_connections') return { data: options.noCredentials ? null : {
            phone_number_id: 'business-phone', access_token_encrypted: 'encrypted', app_secret_encrypted: null,
          } };
          if (table === 'internal_settings') return { data: { value: options.templateConfig ?? '{"name":"weekly_report","language":"ms","approved":true}' } };
          if (options.windowThrows) throw new Error('database unavailable');
          return { data: { last_customer_message_at: options.timestamp ?? new Date(Date.now() - 1000).toISOString() }, error: options.databaseError };
        },
      };
      return builder;
    },
    async rpc(name, args) { events.push({ name, args }); return { data: true, error: options.rpcError }; },
  };
  const window = load('../src/lib/whatsapp-window.server.ts', { '@/integrations/supabase/client.server': { supabaseAdmin: admin } });
  const sender = load('../src/lib/whatsapp.server.ts', {
    '@/integrations/supabase/client.server': { supabaseAdmin: admin },
    './wa-crypto.server': { decryptSecret() { return 'secret'; } },
    './delivery-error': errors,
    './whatsapp-window.server': window,
  }, { process: { env: { WHATSAPP_BSUID_ENABLED: options.bsuidEnabled ? 'true' : '' } }, fetch: async (url, request) => {
    requests.push({ url, body: JSON.parse(request.body) });
    return { ok: options.status == null || options.status < 400, status: options.status ?? 200,
      async json() { if (options.invalidJson) throw new Error('json'); return options.body ?? { messages: [{ id: 'wamid.accepted' }] }; } };
  } });
  return { window, sender, requests, events, queries };
}

test('service window includes just before 24h, excludes exact boundary, future and missing values', () => {
  const { window } = harness();
  const now = Date.parse('2026-11-20T10:00:00Z');
  assert.equal(window.isCustomerServiceWindowOpen(new Date(now - 86400000 + 1).toISOString(), now), true);
  for (const value of [null, undefined, '', 'invalid', new Date(now + 1).toISOString(), new Date(now - 86400000).toISOString()]) {
    assert.equal(window.isCustomerServiceWindowOpen(value, now), false);
  }
});

test('provider timestamp uses event seconds, rejects future and does not substitute arrival time', async () => {
  const h = harness();
  const seconds = Math.floor(Date.now() / 1000) - 100;
  assert.equal(await h.window.recordCustomerServiceEvent('owner', '+60 123456789', String(seconds), 'business-phone'), true);
  assert.equal(h.events[0].args.p_provider_timestamp, new Date(seconds * 1000).toISOString());
  assert.equal(h.events[0].args.p_recipient_id, '60123456789');
  for (const value of [undefined, 'bad', '999999999999', -1]) {
    assert.equal(await h.window.recordCustomerServiceEvent('owner', '60123456789', value, 'business-phone'), false);
  }
  assert.equal(h.events.length, 1);
  await assert.rejects(harness({ rpcError: {} }).window.recordCustomerServiceEvent('owner', '60123456789', seconds, 'business-phone'));
});

test('recipient validation preserves complete BSUID and normalizes formatted phone', () => {
  const { window } = harness();
  assert.equal(window.whatsappRecipientId('MY.a1B2'), 'MY.a1B2');
  assert.equal(window.whatsappRecipientId('+60 (12) 345-6789'), '60123456789');
  for (const value of ['customer', 'MY.', 'my.a1', 'MY.bad-id', '123']) assert.equal(window.whatsappRecipientId(value), null);
});

test('closed, unknown and unreadable service windows prevent free text provider calls', async () => {
  for (const options of [{ timestamp: new Date(Date.now() - 86400000).toISOString() }, { timestamp: 'unknown' }, { databaseError: {} }, { windowThrows: true }]) {
    const h = harness(options);
    const result = await h.sender.sendWhatsAppMessage('60123456789', 'reply', 'owner');
    assert.equal(result.ok, false);
    assert.equal(result.error, errors.DELIVERY_ERRORS.windowClosed);
    assert.equal(result.retryable, false);
    assert.equal(h.requests.length, 0);
  }
});

test('open-window send scopes lookup and returns accepted provider identity', async () => {
  const h = harness();
  const result = await h.sender.sendWhatsAppMessage('+60 123456789', 'hello', 'owner');
  assert.equal(result.providerMessageId, 'wamid.accepted');
  assert.equal(result.providerPhoneNumberId, 'business-phone');
  assert.deepEqual(h.requests[0].body, { messaging_product: 'whatsapp', to: '60123456789', type: 'text', text: { body: 'hello' } });
  assert.deepEqual(h.queries.find(q => q.table === 'whatsapp_service_windows'), {
    table: 'whatsapp_service_windows', business_id: 'owner', phone_number_id: 'business-phone', recipient_id: '60123456789',
  });
});

test('BSUID sends use recipient instead of to', async () => {
  const disabled = harness();
  const rejected = await disabled.sender.sendWhatsAppMessage('MY.a1B2', 'reply', 'owner');
  assert.equal(rejected.error, errors.DELIVERY_ERRORS.bsuidUnavailable);
  assert.equal(rejected.retryable, false);
  assert.equal(disabled.requests.length, 0);
  const closed = harness({ bsuidEnabled: true, timestamp: 'unknown' });
  assert.equal((await closed.sender.sendWhatsAppMessage('MY.a1B2', 'reply', 'owner')).error, errors.DELIVERY_ERRORS.windowClosed);
  assert.equal(closed.requests.length, 0);
  const h = harness({ bsuidEnabled: true });
  assert.equal((await h.sender.sendWhatsAppMessage('MY.a1B2', 'reply', 'owner')).ok, true);
  assert.equal(h.requests[0].body.recipient, 'MY.a1B2');
  assert.equal('to' in h.requests[0].body, false);
});

test('approved-template path sends structured parameters outside service window', async () => {
  const h = harness({ timestamp: 'unknown' });
  const result = await h.sender.sendWhatsAppTemplate('60123456789', { name: 'weekly_report', language: 'ms', bodyParameters: ['Kedai', '10', '0.5', '20'] }, 'owner');
  assert.equal(result.ok, true);
  assert.equal(h.requests[0].body.type, 'template');
  assert.equal(h.requests[0].body.template.language.code, 'ms');
  assert.deepEqual(h.requests[0].body.template.components[0].parameters.map(p => p.text), ['Kedai', '10', '0.5', '20']);
  assert.equal(h.queries.some(q => q.table === 'whatsapp_service_windows'), false);
});

test('missing unapproved or malformed weekly template fails closed', async () => {
  for (const templateConfig of ['null', '{}', '{"name":"weekly_report","language":"ms"}', '{"name":"INVALID","language":"ms","approved":true}', 'bad']) {
    assert.equal(await harness({ templateConfig }).window.weeklyReportTemplate('owner'), null);
  }
  assert.equal((await harness().window.weeklyReportTemplate('owner')).name, 'weekly_report');
  const h = harness();
  assert.equal((await h.sender.sendWhatsAppTemplate('60123456789', { name: '../bad', language: 'ms' }, 'owner')).ok, false);
  assert.equal(h.requests.length, 0);
});

test('provider template rejection stays failure and HTTP acceptance without id cannot prompt retry', async () => {
  const rejected = await harness({ status: 400 }).sender.sendWhatsAppTemplate('60123456789', { name: 'weekly_report', language: 'ms' }, 'owner');
  assert.equal(rejected.ok, false);
  for (const options of [{ body: {} }, { invalidJson: true }]) {
    const result = await harness(options).sender.sendWhatsAppMessage('60123456789', 'reply', 'owner');
    assert.equal(result.ok, true);
    assert.equal(result.trackingUncertain, true);
    assert.equal(result.providerMessageId, undefined);
  }
});
