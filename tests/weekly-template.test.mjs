import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { timingSafeEqual } from 'node:crypto';

function harness(options = {}) {
  const sends = [], updates = [], tracked = [];
  const profile = { id: 'owner', business_name: 'Kedai', owner_whatsapp: '60123456789', weekly_report_sent_at: options.sentAt ?? null };
  const admin = {
    auth: { admin: { async getUserById() { return { data: { user: { user_metadata: { weekly: options.optedOut !== true } } }, error: options.ownerError }; } } },
    from(table) {
      const filters = {};
      let patch;
      const builder = {
        select() { return this; }, eq(key, value) { filters[key] = value; return this; }, not() { return this; },
        gte() { return this; }, limit() { return this; }, update(value) { patch = value; return this; },
        async maybeSingle() { return { data: { value: 'report-token' } }; },
        then(resolve, reject) {
          if (patch) updates.push({ table, patch, filters });
          const data = table === 'profiles' ? [profile] : table === 'messages' ? [{ chat_id: 'chat', created_at: '2026-11-20T00:00:00Z' }] : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const dependencies = {
    '@/lib/preferences': { accountPreferences: metadata => ({ weeklyReport: metadata.weekly }) },
    '@tanstack/react-router': { createFileRoute: () => config => config },
    crypto: { timingSafeEqual },
    '@/lib/metrics': { summarize: () => ({ totalMessages: 1, autoAnswered: 12, savedMs: 1800000, handoffRate: 25 }) },
    '@/integrations/supabase/client.server': { supabaseAdmin: admin },
    '@/lib/whatsapp.server': { async sendWhatsAppTemplate(...args) { sends.push(args); return options.providerFailure ? { ok: false, error: 'provider_rejected' } : { ok: true, providerMessageId: 'wamid.report' }; } },
    '@/lib/whatsapp-window.server': { async weeklyReportTemplate() { return options.noTemplate ? null : { name: 'weekly_report', language: 'ms' }; } },
    '@/lib/delivery-status.server': { async recordWhatsAppReportAcceptance(...args) { tracked.push(args); } },
  };
  const source = readFileSync(new URL('../src/routes/api/public/hooks/weekly-report.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { if (name in dependencies) return dependencies[name]; throw new Error(name); },
    Date, Buffer, Response, console: { error() {} } });
  return { sends, updates, tracked, async run(token = 'report-token') {
    return module.exports.Route.server.handlers.POST({ request: new Request('http://localhost', { method: 'POST', headers: { 'x-report-token': token } }) });
  } };
}

test('weekly report uses configured template parameter order and registers acceptance', async () => {
  const h = harness();
  const result = await (await h.run()).json();
  assert.equal(result.sent, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.sends[0])), ['60123456789', {
    name: 'weekly_report', language: 'ms', bodyParameters: ['Kedai', '12', '0.5', '25'],
  }, 'owner']);
  assert.equal(h.tracked.length, 1);
  assert.equal(h.updates.length, 1);
});

test('weekly preferences, invalid owner reads and dedupe prevent sends', async () => {
  for (const options of [{ optedOut: true }, { ownerError: {} }, { sentAt: new Date().toISOString() }]) {
    const h = harness(options);
    assert.equal((await (await h.run()).json()).sent, 0);
    assert.equal(h.sends.length, 0);
    assert.equal(h.updates.length, 0);
  }
});

test('missing template and provider rejection return visible failure without marking report sent', async () => {
  for (const options of [{ noTemplate: true }, { providerFailure: true }]) {
    const h = harness(options);
    const result = await (await h.run()).json();
    assert.equal(result.sent, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(h.updates.length, 0);
    assert.equal(h.tracked.length, 0);
  }
});

test('invalid cron token cannot send reports', async () => {
  const h = harness();
  assert.equal((await h.run('wrong-token')).status, 401);
  assert.equal(h.sends.length, 0);
});
