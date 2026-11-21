import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

// This suite writes only to an explicitly selected disposable loopback backend.
// Run: LOKALCHAT_LIVE_ENV=/private/test.env node --import tsx --test tests/local-account-live.test.mjs
const envFile = process.env.LOKALCHAT_LIVE_ENV;

test('local accounts retain isolated real backend identities through logout, login and restart', {
  skip: !envFile && 'Set LOKALCHAT_LIVE_ENV to an isolated loopback Supabase test environment',
  timeout: 180_000,
}, async (t) => {
  const configured = parseEnv(await readFile(envFile, 'utf8'));
  const url = new URL(configured.SUPABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Live test refuses hosted backends');
  assert.equal(configured.LOKALCHAT_DISPOSABLE_TEST, '1', 'Backend must be explicitly marked disposable');
  assert.ok(configured.SUPABASE_PUBLISHABLE_KEY && configured.SUPABASE_SERVICE_ROLE_KEY);
  const directory = await mkdtemp(join(tmpdir(), 'lokalchat-local-account-live-'));
  const savedEnv = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'LOKALCHAT_ACCOUNT_DB', 'LOKALCHAT_USER_ENV_DIR'].map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SUPABASE_URL: configured.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: configured.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: configured.SUPABASE_SERVICE_ROLE_KEY,
    LOKALCHAT_ACCOUNT_DB: join(directory, 'accounts.sqlite'),
    LOKALCHAT_USER_ENV_DIR: join(directory, 'users'),
  });
  const { handleAccountRequest } = await import('../src/lib/account-http.server.ts');
  const { localBackendContext } = await import('../src/lib/account-backend.server.ts');
  const { accountInstallationId, accountProfile } = await import('../src/lib/account-store.server.ts');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(configured.SUPABASE_URL, configured.SUPABASE_SERVICE_ROLE_KEY, options);
  const ids = [];
  const files = [];
  const password = `Disposable-${randomUUID()}-Aa1!`;
  const prefix = randomUUID();
  const actors = [];
  const origin = 'http://127.0.0.1:3011';
  const localRequest = (cookie, expected, bearer) => new Request(`${origin}/api/test`, {
    headers: { ...(cookie ? { cookie } : {}), ...(expected ? { 'x-lokalchat-account': expected } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  });
  const accountRequest = async (body, cookie) => {
    const response = await handleAccountRequest(new Request(`${origin}/api/account`, {
      method: body ? 'POST' : 'GET',
      headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const payload = await response.json();
    return { status: response.status, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const expectRows = (result, message) => {
    assert.equal(result.error, null, message);
    return result.data;
  };
  try {
    await t.test('two local registrations provision same-UUID trusted backend owners', async () => {
      for (const label of ['A', 'B']) {
        const email = `local-live-${prefix}-${label.toLowerCase()}@example.test`;
        const result = await accountRequest({ action: 'signup', email, password, businessName: `Disposable Shop ${label}` });
        assert.equal(result.status, 200, `Signup ${label} failed`);
        assert.ok(result.cookie?.startsWith('lokalchat_session='));
        const actor = { label, email, id: result.payload.user.id, cookie: result.cookie };
        ids.push(actor.id);
        actors.push(actor);
        const concurrent = await Promise.all(Array.from({ length: 3 }, () => localBackendContext(localRequest(actor.cookie, actor.id))));
        assert.ok(concurrent.every(context => context.userId === actor.id), 'Concurrent first requests must share a valid owner identity');
        actor.context = concurrent[0];
        assert.equal(actor.context.userId, actor.id);
        const backend = await admin.auth.admin.getUserById(actor.id);
        assert.equal(backend.error, null);
        assert.equal(backend.data.user.id, actor.id);
        assert.equal(backend.data.user.app_metadata.lokalchat_installation_id, accountInstallationId());
        assert.equal(backend.data.user.app_metadata.lokalchat_account_id, actor.id);
        assert.notEqual(backend.data.user.email, email, 'Local login email is not a backend bearer identity');
      }
      assert.notEqual(actors[0].id, actors[1].id);
    });

    await t.test('profile, chats, messages, FAQ and private Storage enforce account ownership', async () => {
      for (const actor of actors) {
        const db = actor.context.supabase;
        const chat = expectRows(await db.from('chats').insert({ business_id: actor.id, customer_phone: `test-${actor.label}-${prefix}`, customer_name: `Customer ${actor.label}` }).select('id,business_id').single(), 'Create own chat');
        actor.chat = chat;
        expectRows(await db.from('messages').insert({ chat_id: chat.id, sender: 'customer', text: `Private ${actor.label} message` }).select('id').single(), 'Create own message');
        actor.faq = expectRows(await db.from('knowledge_base').insert({ business_id: actor.id, content: `Private ${actor.label} FAQ ${prefix}` }).select('id').single(), 'Create own FAQ');
        actor.path = `${actor.id}/${prefix}-${actor.label}.txt`;
        expectRows(await db.storage.from('kb-documents').upload(actor.path, new Blob([`Private ${actor.label} file`], { type: 'text/plain' })), 'Upload own file');
        files.push(actor.path);
        actor.document = expectRows(await db.from('kb_documents').insert({ business_id: actor.id, file_name: `${actor.label}.txt`, storage_path: actor.path, file_type: 'txt', file_size: 14 }).select('id').single(), 'Create own document');
      }
      for (const actor of actors) {
        const other = actors.find(item => item !== actor);
        const db = actor.context.supabase;
        assert.deepEqual(expectRows(await db.from('chats').select('id,business_id'), 'List own chats').map(row => row.business_id), [actor.id]);
        assert.equal(expectRows(await db.from('chats').select('id').eq('id', other.chat.id), 'Read foreign chat').length, 0);
        assert.equal(expectRows(await db.from('messages').select('id').eq('chat_id', other.chat.id), 'Read foreign messages').length, 0);
        assert.equal(expectRows(await db.from('knowledge_base').select('id').eq('id', other.faq.id), 'Read foreign FAQ').length, 0);
        assert.equal(expectRows(await db.from('kb_documents').select('id').eq('id', other.document.id), 'Read foreign document').length, 0);
        assert.ok((await db.from('chats').insert({ business_id: other.id, customer_phone: `forged-${randomUUID()}` })).error, 'Forged owner insert must fail');
        const update = await db.from('chats').update({ customer_name: 'Forged' }).eq('id', other.chat.id).select('id');
        assert.ok(update.error || update.data.length === 0, 'Foreign chat update must not succeed');
        assert.ok((await db.from('messages').insert({ chat_id: other.chat.id, sender: 'human', text: 'Forged reply' })).error, 'Foreign chat message insert must fail');
        assert.ok((await db.storage.from('kb-documents').download(other.path)).error, 'Foreign file download must fail');
        assert.ok((await db.storage.from('kb-documents').upload(`${other.id}/forged-${randomUUID()}.txt`, new Blob(['forged'], { type: 'text/plain' }))).error, 'Foreign upload prefix must fail');
        assert.ok((await db.from('profiles').update({ role: 'admin' }).eq('id', actor.id)).error, 'Self-promotion must fail');
      }
    });

    await t.test('expected-account binding rejects delayed A work under B cookie and forged account IDs', async () => {
      const [a, b] = actors;
      await assert.rejects(localBackendContext(localRequest(b.cookie, a.id)), /Unauthorized|akaun|sesi/i);
      await assert.rejects(localBackendContext(localRequest(a.cookie, b.id)), /Unauthorized|akaun|sesi/i);
      const aAgain = await localBackendContext(localRequest(a.cookie, a.id));
      assert.equal(aAgain.userId, a.id);
    });

    await t.test('concurrent independent local sessions for one account provision valid scoped clients', async () => {
      const [a] = actors;
      const signedIn = await Promise.all(Array.from({ length: 2 }, () => accountRequest({ action: 'signin', email: a.email, password })));
      assert.ok(signedIn.every(result => result.status === 200));
      assert.notEqual(signedIn[0].cookie, signedIn[1].cookie);
      try {
        const contexts = await Promise.all(signedIn.map(result => localBackendContext(localRequest(result.cookie, a.id))));
        for (const context of contexts) {
          assert.equal(context.userId, a.id);
          assert.deepEqual(expectRows(await context.supabase.from('chats').select('id'), 'Concurrent session chats').map(row => row.id), [a.chat.id]);
        }
      } finally {
        for (const result of signedIn) await accountRequest({ action: 'signout' }, result.cookie);
      }
    });

    await t.test('local cookie wins over another valid hosted bearer; invalid cookie cannot inherit that bearer', async () => {
      const [a, b] = actors;
      const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: (await admin.auth.admin.getUserById(b.id)).data.user.email });
      assert.equal(link.error, null);
      const verifier = createClient(configured.SUPABASE_URL, configured.SUPABASE_PUBLISHABLE_KEY, options);
      const verified = await verifier.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
      assert.equal(verified.error, null);
      assert.ok(verified.data.session?.access_token);
      const context = await localBackendContext(localRequest(a.cookie, a.id, verified.data.session.access_token));
      assert.equal(context.userId, a.id);
      await assert.rejects(localBackendContext(localRequest('lokalchat_session=revoked-not-a-real-session', a.id, verified.data.session.access_token)), /Unauthorized|log masuk/i);
    });

    await t.test('logout rejects the old local session; relogin retains only the original owner data', async () => {
      const [a, b] = actors;
      const oldCookie = a.cookie;
      const result = await accountRequest({ action: 'signout', scope: 'local' }, a.cookie);
      assert.equal(result.status, 200);
      const revoked = await accountRequest(undefined, oldCookie);
      assert.equal(revoked.status, 401, 'Revoked supplied cookie must fail closed');
      assert.ok(!revoked.payload.user);
      await assert.rejects(localBackendContext(localRequest(oldCookie, a.id)), /Unauthorized|log masuk/i);
      assert.equal((await localBackendContext(localRequest(b.cookie, b.id))).userId, b.id, 'A logout must not revoke B');
      const signedIn = await accountRequest({ action: 'signin', email: a.email, password });
      assert.equal(signedIn.status, 200);
      assert.equal(signedIn.payload.user.id, a.id);
      assert.notEqual(signedIn.cookie, oldCookie);
      a.cookie = signedIn.cookie;
      a.context = await localBackendContext(localRequest(a.cookie, a.id));
      const rows = expectRows(await a.context.supabase.from('chats').select('id,business_id'), 'Relogin chats');
      assert.deepEqual(rows.map(row => row.id), [a.chat.id]);
    });

    await t.test('profile updates sync only to its corresponding backend owner', async () => {
      const [a, b] = actors;
      accountProfile(a.id, { business_name: 'Updated private Shop A', owner_whatsapp: '+60123456789', inventory_api_url: 'https://inventory.example.test/api' });
      const updated = await accountRequest({ action: 'update', data: { lokalchat_reply_language: 'en', lokalchat_weekly_report: false } }, a.cookie);
      assert.equal(updated.status, 200);
      const immediateMetadata = (await admin.auth.admin.getUserById(a.id)).data.user.user_metadata;
      assert.equal(immediateMetadata.lokalchat_reply_language, 'en', 'Successful account update must propagate without another data request');
      assert.equal(immediateMetadata.lokalchat_weekly_report, false, 'Successful opt-out must reach scheduled jobs before returning');
      await localBackendContext(localRequest(a.cookie, a.id));
      const profileA = expectRows(await admin.from('profiles').select('business_name,owner_whatsapp,inventory_api_url').eq('id', a.id).single(), 'Read A profile');
      const profileB = expectRows(await admin.from('profiles').select('business_name,owner_whatsapp,inventory_api_url').eq('id', b.id).single(), 'Read B profile');
      assert.equal(profileA.business_name, 'Updated private Shop A');
      assert.equal(profileA.owner_whatsapp, '+60123456789');
      assert.equal(profileA.inventory_api_url, 'https://inventory.example.test/api');
      assert.equal(profileB.business_name, 'Disposable Shop B');
      assert.notEqual(profileB.owner_whatsapp, profileA.owner_whatsapp);
      assert.notEqual(profileB.inventory_api_url, profileA.inventory_api_url);
      const userA = (await admin.auth.admin.getUserById(a.id)).data.user;
      const userB = (await admin.auth.admin.getUserById(b.id)).data.user;
      assert.equal(userA.user_metadata.lokalchat_reply_language, 'en');
      assert.equal(userA.user_metadata.lokalchat_weekly_report, false);
      assert.notEqual(userB.user_metadata.lokalchat_reply_language, 'en');
      assert.notEqual(userB.user_metadata.lokalchat_weekly_report, false);
    });

    await t.test('unrelated pre-existing backend UUID cannot be adopted', async () => {
      const result = await accountRequest({ action: 'signup', email: `collision-${prefix}@example.test`, password, businessName: 'Collision test' });
      assert.equal(result.status, 200);
      const id = result.payload.user.id;
      ids.push(id);
      const created = await admin.auth.admin.createUser({ id, email: `hosted-${prefix}@example.test`, password, email_confirm: true });
      assert.equal(created.error, null, 'Prepare unrelated backend identity');
      await assert.rejects(localBackendContext(localRequest(result.cookie, id)), /sambungan|backend|data|identiti/i);
      const retained = await admin.auth.admin.getUserById(id);
      assert.equal(retained.data.user.email, `hosted-${prefix}@example.test`);
      assert.equal(retained.data.user.app_metadata.lokalchat_installation_id, undefined);
    });

    await t.test('cached sessions reject a backend owner whose trusted installation marker changes', async () => {
      const [, b] = actors;
      const before = (await admin.auth.admin.getUserById(b.id)).data.user;
      const original = { ...before.app_metadata };
      const tampered = await admin.auth.admin.updateUserById(b.id, { app_metadata: { ...original, lokalchat_installation_id: randomUUID() } });
      assert.equal(tampered.error, null);
      try {
        await assert.rejects(localBackendContext(localRequest(b.cookie, b.id)), /sambungan|backend|data|identiti/i);
      } finally {
        const restored = await admin.auth.admin.updateUserById(b.id, { app_metadata: original });
        assert.equal(restored.error, null);
      }
      assert.equal((await localBackendContext(localRequest(b.cookie, b.id))).userId, b.id);
    });

    await t.test('a fresh server process preserves installation binding and local cookie ownership', async () => {
      const [a, b] = actors;
      const code = `
        import assert from 'node:assert/strict';
        import { localBackendContext } from './src/lib/account-backend.server.ts';
        import { accountInstallationId } from './src/lib/account-store.server.ts';
        const context = await localBackendContext(new Request('http://127.0.0.1:3011/api/test', {headers: {cookie: process.env.LIVE_TEST_COOKIE, 'x-lokalchat-account': process.env.LIVE_TEST_ACCOUNT}}));
        assert.equal(context.userId, process.env.LIVE_TEST_ACCOUNT);
        assert.equal(accountInstallationId(), process.env.LIVE_TEST_INSTALLATION);
        const result = await context.supabase.from('chats').select('business_id');
        assert.equal(result.error, null);
        assert.deepEqual(result.data.map(row => row.business_id), [process.env.LIVE_TEST_ACCOUNT]);
        console.log('Restart ownership verified');
      `;
      for (const actor of [a, b]) {
        const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
          cwd: process.cwd(), env: { ...process.env, LIVE_TEST_COOKIE: actor.cookie, LIVE_TEST_ACCOUNT: actor.id, LIVE_TEST_INSTALLATION: accountInstallationId() },
          encoding: 'utf8', timeout: 30_000,
        });
        assert.equal(child.status, 0, `Fresh process failed for ${actor.label}; inspect private runner logs`);
        assert.ok(child.stdout.includes('Restart ownership verified'));
      }
    });
  } finally {
    if (files.length) await admin.storage.from('kb-documents').remove(files);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
