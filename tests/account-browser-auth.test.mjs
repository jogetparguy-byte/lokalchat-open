import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/account-auth.ts', import.meta.url), 'utf8');

function browser() {
  const user = id => ({ id, email: `${id}@example.test`, user_metadata: {}, app_metadata: {} });
  const state = { local: null, hosted: null, owner: null, localMode: false, updates: 0, signouts: 0, clears: 0, pendingHosted: null, beforeGet: null };
  const auth = {
    getUser: async () => ({ data: { user: state.hosted }, error: null }),
    async signInWithPassword() {
      if (state.pendingHosted) await state.pendingHosted;
      state.hosted = user('hosted-a');
      return { data: { user: state.hosted, session: { user: state.hosted } }, error: null };
    },
    async updateUser(input) { state.updates++; state.hosted = { ...state.hosted, user_metadata: input.data }; return { data: { user: state.hosted }, error: null }; },
    async signOut() { state.signouts++; state.hosted = null; return { error: null }; },
  };
  const context = {
    exports: {}, Response, Headers, crypto: { randomUUID: () => 'event-fixture' },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { dispatchEvent() {} }, localStorage: { setItem() {} },
    env: { VITE_SUPABASE_URL: 'https://fixture.supabase.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' },
    async fetch(_url, options) {
      const data = options.body ? JSON.parse(options.body) : null;
      if (!data) { if (state.beforeGet) await state.beforeGet(); return Response.json({ user: state.local }); }
      if (data.action === 'signin' || data.action === 'signup') {
        if (data.email.startsWith('local')) { state.local = user(data.email.split('@')[0]); return Response.json({ user: state.local }); }
        return Response.json({ error: 'Emel atau kata laluan tidak tepat.' }, { status: 400 });
      }
      if (data.action === 'hosted') { state.clears++; state.local = null; return Response.json({ user: null }); }
      const expected = new Headers(options.headers).get('x-lokalchat-account');
      if (!state.local || expected && expected !== state.local.id) return Response.json({ error: 'Akaun telah berubah' }, { status: 401 });
      if (data.action === 'update') { state.local = { ...state.local, user_metadata: data.data }; return Response.json({ user: state.local }); }
      if (data.action === 'signout') { state.local = null; return Response.json({ user: null }); }
      throw new Error('Unexpected action');
    },
    require(name) {
      if (name === '@/integrations/supabase/client') return { supabase: { auth } };
      if (name === './public-config') return { hasPublicConfig: () => true };
      if (name === './account-identity') return {
        accountIdentity: () => state.owner, setAccountIdentity: id => { state.owner = id; },
        localAuthMode: () => state.localMode, setLocalAuthMode: () => { state.localMode = true; }, setHostedAuthMode: () => { state.localMode = false; },
      };
      throw new Error('Unexpected import ' + name);
    },
  };
  const code = ts.transpileModule(source.replaceAll('import.meta.env', 'env'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, context);
  return { state, api: context.exports.accountAuth, user };
}

test('explicit hosted login remains usable for getUser, updateUser and logout', async () => {
  const h = browser();
  h.state.localMode = true;
  assert.equal((await h.api.signInWithPassword({ email: 'hosted@example.test', password: 'fixture' })).error, null);
  assert.equal(h.state.localMode, false);
  assert.equal(h.state.clears, 1);
  assert.equal((await h.api.getUser()).data.user.id, 'hosted-a');
  assert.equal((await h.api.updateUser({ data: { full_name: 'Updated' } })).error, null);
  assert.equal(h.state.updates, 1);
  assert.equal((await h.api.signOut({ scope: 'local' })).error, null);
  assert.equal(h.state.owner, null);
  assert.equal(h.state.hosted, null);
});

test('stale hosted owner cannot mutate or sign out a replacement hosted owner', async () => {
  const h = browser();
  h.state.hosted = h.user('hosted-a');
  await h.api.getUser();
  h.state.hosted = h.user('hosted-b');
  assert.match((await h.api.updateUser({ data: { full_name: 'Wrong' } })).error.message, /Akaun telah berubah/);
  assert.match((await h.api.signOut()).error.message, /Akaun telah berubah/);
  assert.equal(h.state.updates, 0);
  assert.equal(h.state.signouts, 0);
  assert.equal(h.state.hosted.id, 'hosted-b');
});

test('local logout does not resurrect a stored hosted account', async () => {
  const h = browser();
  await h.api.signInWithPassword({ email: 'local-a@example.test', password: 'fixture' });
  await h.api.signOut();
  h.state.hosted = h.user('stale-hosted');
  assert.equal((await h.api.getUser()).data.user, null);
  assert.equal(h.state.owner, null);
});

test('local mutation checks its captured owner after the session-read await', async () => {
  const h = browser();
  await h.api.signInWithPassword({ email: 'local-a@example.test', password: 'fixture' });
  h.state.beforeGet = async () => { h.state.local = h.user('local-b'); };
  assert.match((await h.api.updateUser({ data: { full_name: 'Wrong' } })).error.message, /Akaun telah berubah/);
  assert.match((await h.api.signOut()).error.message, /Akaun telah berubah/);
  assert.equal(h.state.local.id, 'local-b');
});

test('a delayed hosted login cannot clear a newer local account', async () => {
  const h = browser();
  let release;
  h.state.pendingHosted = new Promise(resolve => { release = resolve; });
  const old = h.api.signInWithPassword({ email: 'hosted@example.test', password: 'fixture' });
  await new Promise(resolve => setImmediate(resolve));
  await h.api.signInWithPassword({ email: 'local-b@example.test', password: 'fixture' });
  release();
  assert.match((await old).error.message, /Akaun telah berubah/);
  assert.equal(h.state.clears, 0);
  assert.equal(h.state.local.id, 'local-b');
  assert.equal(h.state.localMode, true);
});
