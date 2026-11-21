import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const task = '33333333-3333-4333-8333-333333333333';
const notice = '44444444-4444-4444-8444-444444444444';

function load(path, dependencies, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, Headers, Request, console,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    }, ...globals,
  });
  return module.exports;
}

function harness(options = {}) {
  const queries = [], calls = [];
  const rows = {
    handoff_tasks: [
      { id: task, business_id: owner, status: 'pending' },
      { id: 'resolved', business_id: owner, status: 'resolved' },
      { id: 'foreign', business_id: other, status: 'pending' },
    ],
    chats: [
      { id: task, business_id: owner, customer_name: 'Aina' },
      { id: notice, business_id: other, customer_name: 'Private' },
    ],
    handoff_notifications: [
      { id: notice, task_id: task, business_id: owner, status: 'uncertain' },
      { id: 'foreign-notice', task_id: task, business_id: other, status: 'failed' },
    ],
    profiles: [
      { id: other, handoff_notification_channel: 'in_app', owner_whatsapp: 'private-other-owner' },
      { id: owner, handoff_notification_channel: 'in_app', owner_whatsapp: null },
    ],
  };
  const client = {
    auth: { async getClaims() { return options.invalidToken
      ? { data: null, error: new Error('private-auth-error') }
      : { data: { claims: { sub: owner } }, error: null }; } },
    from(table) {
      const filters = [], query = { table, filters };
      queries.push(query);
      const builder = {
        select() { return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        neq(key, value) { filters.push(row => row[key] !== value); return this; },
        in(key, values) { filters.push(row => values.includes(row[key])); return this; },
        order() { return this; }, limit() { return this; },
        update(value) { query.update = value; return this; },
        async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        const result = rows[table].filter(row => filters.every(filter => filter(row)));
        if (query.update && !options.dbError) for (const row of result) Object.assign(row, query.update);
        return { data: result, error: options.dbError ? { message: 'private-database-error' } : null };
      }
      return builder;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: options.changed !== false, error: options.dbError ? { message: 'private-database-error' } : null };
    },
  };
  const request = { headers: new Headers({
    ...(options.noLogin ? {} : { authorization: 'Bearer fixture.jwt.token' }),
    ...(options.expected ? { 'x-lokalchat-account': options.expected } : {}),
  }) };
  const { requireSupabaseAuth } = load('../src/integrations/supabase/auth-middleware.ts', {
    '@tanstack/react-start': { createMiddleware: () => ({ server: fn => fn }) },
    '@tanstack/react-start/server': { getRequest: () => request },
    '@supabase/supabase-js': { createClient: () => client },
    '@/lib/account-http.server': { accountToken: () => undefined },
  }, { process: { env: { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key' } } });
  const api = load('../src/lib/handoff.functions.ts', {
    '@tanstack/react-start': { createServerFn() {
      let validator = value => value;
      return {
        middleware(items) { assert.equal(items.length, 1); assert.equal(items[0], requireSupabaseAuth); return this; },
        inputValidator(fn) { validator = fn; return this; },
        handler(fn) { return async (input = {}) => requireSupabaseAuth({
          next: async ({ context }) => fn({ context, data: await validator(input.data) }),
        }); },
      };
    } },
    '@/integrations/supabase/auth-middleware': { requireSupabaseAuth },
  });
  return { api, rows, queries, calls };
}

test('every handoff endpoint rejects missing or invalid credentials before database access', async () => {
  for (const options of [{ noLogin: true }, { invalidToken: true }]) {
    const h = harness(options);
    for (const fn of Object.values(h.api)) await assert.rejects(fn({ data: {} }), /Unauthorized/);
    assert.equal(h.queries.length, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('account switch mismatch rejects handoff mutations before database access', async () => {
  const h = harness({ expected: other });
  await assert.rejects(h.api.setHandoffChannel({ data: { channel: 'whatsapp' } }), /Akaun telah berubah/);
  await assert.rejects(h.api.transitionHandoffTask({ data: { taskId: task, expectedStatus: 'pending', status: 'accepted' } }), /Akaun telah berubah/);
  assert.equal(h.queries.length, 0);
  assert.equal(h.calls.length, 0);
});

test('task list and attached notifications use verified account and resolved filter', async () => {
  const h = harness();
  const open = await h.api.listHandoffTasks({ data: { businessId: other } });
  assert.deepEqual(Array.from(open, row => row.id), [task]);
  assert.deepEqual(Array.from(open[0].notifications, row => row.id), [notice]);
  const resolved = await h.api.listHandoffTasks({ data: { resolved: true, businessId: other } });
  assert.deepEqual(Array.from(resolved, row => row.id), ['resolved']);
});

test('invalid transitions do not reach SQL and stale CAS produces actionable error', async () => {
  const h = harness({ changed: false });
  await assert.rejects(h.api.transitionHandoffTask({ data: { taskId: task, expectedStatus: 'pending', status: 'resolved' } }), /Perubahan tugasan tidak sah/);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.api.transitionHandoffTask({ data: { taskId: task, expectedStatus: 'pending', status: 'accepted' } }), /Tugasan telah berubah/);
  assert.equal(h.calls[0].name, 'transition_handoff_task');
  assert.equal(h.calls[0].args.p_expected_status, 'pending');
});

test('opening an older handoff chat is scoped to the verified account', async () => {
  const h = harness();
  const chat = await h.api.getHandoffChat({ data: { chatId: task, businessId: other } });
  assert.equal(chat.customer_name, 'Aina');
  assert.equal(await h.api.getHandoffChat({ data: { chatId: notice, businessId: other } }), null);
});

test('explicit retry submits only requested notification and rejects stale or invalid requests', async () => {
  const h = harness();
  await h.api.retryHandoffNotification({ data: { notificationId: notice, businessId: other } });
  assert.equal(h.calls[0].name, 'retry_handoff_notification');
  assert.deepEqual(Object.keys(h.calls[0].args), ['p_id']);
  assert.equal(h.calls[0].args.p_id, notice);
  await assert.rejects(h.api.retryHandoffNotification({ data: { notificationId: 'invalid' } }), /ID tugasan tidak sah/);
  assert.equal(h.calls.length, 1);
  const stale = harness({ changed: false });
  await assert.rejects(stale.api.retryHandoffNotification({ data: { notificationId: notice } }), /Muat semula status tugasan/);
});

test('channel settings cannot read or change a different account or accept unsupported channels', async () => {
  const h = harness();
  assert.equal((await h.api.getHandoffSettings()).owner_whatsapp, null);
  await h.api.setHandoffChannel({ data: { channel: 'whatsapp', businessId: other } });
  assert.equal(h.rows.profiles.find(row => row.id === owner).handoff_notification_channel, 'whatsapp');
  assert.equal(h.rows.profiles.find(row => row.id === other).handoff_notification_channel, 'in_app');
  const reads = h.queries.length;
  await assert.rejects(h.api.setHandoffChannel({ data: { channel: 'email' } }), /Saluran amaran tidak sah/);
  assert.equal(h.queries.length, reads);
});

test('database failures surface safe endpoint messages without private database details', async () => {
  const h = harness({ dbError: true });
  for (const [name, data] of [
    ['listHandoffTasks', {}], ['getHandoffSettings', undefined],
    ['setHandoffChannel', { channel: 'whatsapp' }],
    ['transitionHandoffTask', { taskId: task, expectedStatus: 'pending', status: 'accepted' }],
    ['retryHandoffNotification', { notificationId: notice }],
  ]) await assert.rejects(h.api[name]({ data }), error => !error.message.includes('private-database-error'));
});
