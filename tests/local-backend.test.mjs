import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authenticateAccount, accountInstallationId, accountProfile, revokeAccountSessions } from '../src/lib/account-store.server.ts';
import { localBackendContext, hasAccountBackendConfig } from '../src/lib/account-backend.server.ts';
import { handleAccountRequest } from '../src/lib/account-http.server.ts';

function json(value, status = 200) { return Response.json(value, { status }); }

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lokalchat-local-backend-'));
  const names = ['LOKALCHAT_ACCOUNT_DB', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    LOKALCHAT_ACCOUNT_DB: join(dir, 'accounts.sqlite'),
    SUPABASE_URL: `https://${randomUUID()}.supabase.test`,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture',
  });
  const fetchBefore = globalThis.fetch;
  const users = new Map();
  const profiles = new Map();
  const requests = [];
  const state = { exchanges: 0, creates: 0, onVerify: null, onProfile: null, denyCreate: false };
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    assert.equal(url.origin, process.env.SUPABASE_URL, 'Unexpected outbound request');
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : null;
    requests.push({ path: url.pathname, method, body, headers });
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'GET') {
      const user = users.get(url.pathname.split('/').at(-1));
      return user ? json(user) : json({ code: 'user_not_found', message: 'User not found' }, 404);
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
      if (state.denyCreate) return json({ code: 'email_exists', message: 'Email exists' }, 422);
      state.creates++;
      const user = { ...body, role: 'authenticated', aud: 'authenticated', created_at: new Date().toISOString(), identities: [] };
      delete user.password;
      users.set(user.id, user);
      return json(user);
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'PUT') {
      const id = url.pathname.split('/').at(-1);
      const user = { ...users.get(id), ...body };
      users.set(id, user);
      return json(user);
    }
    if (url.pathname === '/auth/v1/admin/generate_link') {
      const user = [...users.values()].find(value => value.email === body.email);
      assert.ok(user);
      state.exchanges++;
      return json({ ...user, action_link: 'https://example.invalid', hashed_token: user.id, verification_type: 'magiclink' });
    }
    if (url.pathname === '/auth/v1/verify') {
      const user = users.get(body.token_hash);
      if (state.onVerify) await state.onVerify();
      return json({ user, access_token: `backend:${user.id}`, refresh_token: randomUUID(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    if (url.pathname === '/rest/v1/profiles' && method === 'POST') {
      const owner = headers.get('authorization')?.replace('Bearer backend:', '');
      assert.equal(owner, body.id, 'Profile must use owner JWT, never service role');
      assert.notEqual(headers.get('apikey'), 'sb_secret_fixture');
      if (state.onProfile) await state.onProfile(body);
      profiles.set(body.id, { ...profiles.get(body.id), ...body });
      return new Response(null, { status: 201 });
    }
    if (url.pathname === '/rest/v1/chats' && method === 'GET') {
      return json([{ business_id: headers.get('authorization')?.replace('Bearer backend:', '') }]);
    }
    throw new Error(`Unhandled fixture route ${method} ${url.pathname}`);
  };
  t.after(async () => {
    globalThis.fetch = fetchBefore;
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
    }
    await rm(dir, { recursive: true, force: true });
  });
  const signup = async (label) => authenticateAccount({ email: `${label}@example.test`, password: 'Strong-fixture-password-001', businessName: label }, true);
  const request = (session, expected = session.user.id) => new Request('http://localhost/server-fn', { headers: { cookie: `lokalchat_session=${session.token}`, 'x-lokalchat-account': expected } });
  return { users, profiles, requests, state, signup, request };
}

test('local accounts bridge to distinct RLS identities and never expose backend sessions', async t => {
  const f = await fixture(t);
  const a = await f.signup('store-a');
  const b = await f.signup('store-b');
  assert.equal(accountInstallationId(), accountInstallationId(), 'Installation identity persists in SQLite');
  const [first, second] = await Promise.all([localBackendContext(f.request(a)), localBackendContext(f.request(b))]);
  assert.equal(first.userId, a.user.id);
  assert.equal(second.userId, b.user.id);
  assert.notEqual(first.supabase, second.supabase);
  const ca = await first.supabase.from('chats').select('business_id');
  const cb = await second.supabase.from('chats').select('business_id');
  assert.equal(ca.data[0].business_id, a.user.id);
  assert.equal(cb.data[0].business_id, b.user.id);
  for (const account of [a, b]) {
    assert.equal(f.users.get(account.user.id).app_metadata.lokalchat_account_id, account.user.id);
    assert.equal(f.users.get(account.user.id).app_metadata.lokalchat_installation_id, accountInstallationId());
    assert.notEqual(f.users.get(account.user.id).email, account.user.email);
    assert.equal(f.profiles.get(account.user.id).business_name, account.user.user_metadata.business_name);
    const http = await handleAccountRequest(new Request('http://localhost/api/account', { headers: { cookie: `lokalchat_session=${account.token}` } }));
    assert.doesNotMatch(await http.text(), /access_token|refresh_token|sb_secret_|backend:/);
  }
});

test('concurrent provisioning shares the same backend account and token exchange', async t => {
  const f = await fixture(t);
  const a = await f.signup('concurrent');
  const values = await Promise.all(Array.from({ length: 5 }, () => localBackendContext(f.request(a))));
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.exchanges, 1);
  assert.ok(values.every(value => value.userId === a.user.id));
  assert.equal(new Set(values.map(value => value.supabase)).size, 5, 'Client auth state is request scoped');
});

test('mismatching account headers and revoked cookies fail before backend work', async t => {
  const f = await fixture(t);
  const a = await f.signup('old-owner');
  const b = await f.signup('new-owner');
  await assert.rejects(localBackendContext(f.request(b, a.user.id)), /Akaun telah berubah/);
  assert.equal(f.requests.length, 0);
  revokeAccountSessions(a.token, 'local');
  await assert.rejects(localBackendContext(f.request(a)), /Sila log masuk/);
  assert.equal(f.requests.length, 0);
  const response = await handleAccountRequest(new Request('http://localhost/api/account', {
    method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', cookie: `lokalchat_session=${b.token}`, 'x-lokalchat-account': a.user.id },
    body: JSON.stringify({ action: 'update', data: { business_name: 'wrong-owner' } }),
  }));
  assert.equal(response.status, 401);
  assert.equal(accountProfile(b.user.id).business_name, 'new-owner');
});

test('existing backend UUID cannot be adopted using editable metadata', async t => {
  const f = await fixture(t);
  const a = await f.signup('collision');
  f.users.set(a.user.id, { ...a.user, app_metadata: {}, user_metadata: { lokalchat_installation_id: accountInstallationId(), lokalchat_account_id: a.user.id } });
  await assert.rejects(localBackendContext(f.request(a)), /Identiti backend tidak sepadan/);
  assert.equal(f.state.exchanges, 0);
  assert.equal(f.profiles.size, 0);
});

test('email collision cannot fall back to a different backend user', async t => {
  const f = await fixture(t);
  const a = await f.signup('email-collision');
  f.state.denyCreate = true;
  await assert.rejects(localBackendContext(f.request(a)), /Identiti backend tidak sepadan/);
  assert.equal(f.state.exchanges, 0);
});

test('logout during network provisioning prevents the data handler context', async t => {
  const f = await fixture(t);
  const a = await f.signup('logout-race');
  f.state.onVerify = async () => revokeAccountSessions(a.token, 'local');
  await assert.rejects(localBackendContext(f.request(a)), /Sila log masuk/);
  assert.equal(f.profiles.size, 0);
});

test('profile sync preserves backend-only fields and a fresh login keeps the same owner', async t => {
  const f = await fixture(t);
  const a = await f.signup('persistent-owner');
  await localBackendContext(f.request(a));
  f.profiles.get(a.user.id).system_prompt = 'Keep this prompt';
  accountProfile(a.user.id, { business_name: 'Updated owner', owner_whatsapp: '+60111111111' });
  await localBackendContext(f.request(a));
  assert.equal(f.profiles.get(a.user.id).system_prompt, 'Keep this prompt');
  assert.equal(f.profiles.get(a.user.id).business_name, 'Updated owner');
  revokeAccountSessions(a.token, 'local');
  const again = await authenticateAccount({ email: a.user.email, password: 'Strong-fixture-password-001' }, false);
  assert.equal((await localBackendContext(f.request(again))).userId, a.user.id);
  assert.equal(f.state.creates, 1);
  await assert.rejects(localBackendContext(f.request(a)), /Sila log masuk/);
});

test('placeholder backend configuration fails closed', async t => {
  const f = await fixture(t);
  const a = await f.signup('offline');
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'REPLACE_ME';
  assert.equal(hasAccountBackendConfig(), false);
  await assert.rejects(localBackendContext(f.request(a)), /Sambungan data belum tersedia/);
  assert.equal(f.requests.length, 0);
});

test('a settings save mirrors latest metadata and profile after an older in-flight request', async t => {
  const f = await fixture(t);
  const a = await f.signup('settings-race');
  let release;
  let entered;
  const blocked = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  let first = true;
  f.state.onProfile = async () => {
    if (first) { first = false; entered(); await blocked; }
  };
  const old = localBackendContext(f.request(a));
  await waiting;
  accountProfile(a.user.id, { owner_whatsapp: '+60122222222', inventory_api_url: 'https://inventory.example.test/new' });
  const update = handleAccountRequest(new Request('http://localhost/api/account', {
    method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', cookie: `lokalchat_session=${a.token}`, 'x-lokalchat-account': a.user.id },
    body: JSON.stringify({ action: 'update', data: { lokalchat_weekly_report: false, lokalchat_reply_language: 'en' } }),
  }));
  release();
  await old;
  assert.equal((await update).status, 200);
  assert.equal(f.users.get(a.user.id).user_metadata.lokalchat_weekly_report, false);
  assert.equal(f.users.get(a.user.id).user_metadata.lokalchat_reply_language, 'en');
  assert.equal(f.profiles.get(a.user.id).owner_whatsapp, '+60122222222');
  assert.equal(f.profiles.get(a.user.id).inventory_api_url, 'https://inventory.example.test/new');
});
