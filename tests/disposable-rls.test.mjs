/** Real Auth/Data API/Storage tests. Only explicit loopback config is accepted.
 * No .env file, linked Supabase project or standard SUPABASE_* variable is read.
 */
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

export function validateDisposableConfig(config) {
  assert.ok(config && typeof config === 'object', 'Explicit disposable config required');
  const target = new URL(config.apiUrl);
  assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname)
    && target.port && target.pathname === '/' && !target.username && !target.password
    && !target.search && !target.hash, 'Only an explicit loopback HTTP API port is allowed');
  assert.ok(typeof config.publishableKey === 'string' && config.publishableKey.length > 20, 'Disposable public key required');
  assert.ok(typeof config.serviceRoleKey === 'string' && config.serviceRoleKey.length > 20, 'Disposable service key required');
  return config;
}

export async function runDisposableSupabaseChecks(config) {
  validateDisposableConfig(config);
  const { apiUrl: url, publishableKey: publicKey, serviceRoleKey: serviceKey } = config;
const opts = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch(input, init) {
    const destination = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(destination.origin, new URL(url).origin, 'Requests must stay on the disposable API origin');
    return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  } },
};
const admin = createClient(url, serviceKey, opts);
const tenants = [];
const storagePaths = [];
let checks = 0;
let failed = false;
function pass(name) { checks++; console.log(`PASS ${name}`); }
function data(result, name) { if (result.error) throw new Error(`${name} failed (${result.error.code || 'remote error'})`); return result.data; }
async function hidden(client, table, id) {
  const rows = data(await client.from(table).select('id').eq('id', id), `${table} read`);
  assert.equal(rows.length, 0, `${table} cross-tenant read exposed`);
}
async function denyInsert(client, table, row) {
  const result = await client.from(table).insert(row).select('id');
  assert.ok(result.error, `${table} cross-tenant insert accepted`);
}
try {
  for (const label of ['a', 'b']) {
    const email = `lokalchat-rls-${randomUUID()}@example.invalid`;
    const password = randomBytes(30).toString('base64url');
    const client = createClient(url, publicKey, opts);
    const created = data(await client.auth.signUp({ email, password, options: { data: { business_name: 'Disposable LokalChat verification', role: 'admin' } } }), 'public signup');
    assert.ok(created.user?.id, 'Public signup did not create a user');
    const tenant = { id: created.user.id, client, label };
    tenants.push(tenant);
    // Local stack email delivery is not part of these tests. Confirm only the
    // just-created disposable account, then exercise the real password login.
    data(await admin.auth.admin.updateUserById(tenant.id, { email_confirm: true }), 'confirm local account');
    const invalidLogin = await createClient(url, publicKey, opts).auth.signInWithPassword({ email, password: `${password}-wrong` });
    assert.ok(invalidLogin.error && !invalidLogin.data.session, 'Incorrect password must not create a session');
    data(await client.auth.signInWithPassword({ email, password }), 'sign in disposable user');
    const own = data(await client.from('profiles').select('id,role,business_name').eq('id', tenant.id), 'own profile');
    assert.equal(own[0]?.id, tenant.id);
    assert.equal(own[0]?.role, 'sme', 'Signup metadata must not confer admin');
    assert.equal(own[0]?.business_name, 'Disposable LokalChat verification');
    tenant.chat = data(await tenant.client.from('chats').insert({ business_id: tenant.id, customer_phone: `verify-${randomUUID()}`, customer_name: 'Disposable RLS test', is_bot_active: false }).select('id').single(), 'create own chat');
    tenant.message = data(await tenant.client.from('messages').insert({ chat_id: tenant.chat.id, sender: 'human', text: 'Disposable RLS verification; never sent', delivery_status: 'failed' }).select('id').single(), 'create own message');
    tenant.faq = data(await tenant.client.from('knowledge_base').insert({ business_id: tenant.id, content: 'Disposable verification FAQ' }).select('id').single(), 'create own FAQ');
    tenant.handoff = data(await tenant.client.from('handoff_events').insert({ business_id: tenant.id, chat_id: tenant.chat.id }).select('id').single(), 'create own handoff');
    tenant.unanswered = data(await admin.from('unanswered_questions').insert({ business_id: tenant.id, question: 'Disposable unanswered question' }).select('id').single(), 'create unanswered fixture');
    tenant.occurrence = data(await admin.from('unanswered_question_occurrences').insert({ business_id: tenant.id, question_id: tenant.unanswered.id, chat_id: tenant.chat.id, question_text: 'Disposable unanswered occurrence' }).select('id').single(), 'create unanswered occurrence fixture');
    const path = `${tenant.id}/${randomUUID()}-verification.txt`;
    storagePaths.push(path);
    data(await tenant.client.storage.from('kb-documents').upload(path, new Blob(['Disposable verification TXT'], { type: 'text/plain' }), { contentType: 'text/plain', upsert: false }), 'upload own TXT');
    tenant.doc = data(await tenant.client.from('kb_documents').insert({ business_id: tenant.id, file_name: 'verification.txt', file_type: 'TXT', file_size: 27, storage_path: path }).select('id').single(), 'create own KB metadata');
    tenant.path = path;
    const listed = data(await tenant.client.storage.from('kb-documents').list(tenant.id), 'list own TXT');
    assert.ok(listed.some(object => object.name === path.split('/').at(-1)), 'Owner cannot list own object');
    const downloaded = data(await tenant.client.storage.from('kb-documents').download(path), 'download own TXT');
    assert.equal(await downloaded.text(), 'Disposable verification TXT');
    data(await tenant.client.storage.from('kb-documents').upload(path, new Blob(['Updated disposable TXT'], { type: 'text/plain' }), { contentType: 'text/plain', upsert: true }), 'replace own TXT');
    assert.equal(await data(await tenant.client.storage.from('kb-documents').download(path), 'download replaced TXT').text(), 'Updated disposable TXT');
  }
  pass('Two real authenticated users can manage their own rows and private TXT files');
  pass('Incorrect passwords rejected without a session; owners can list their own private files');
  for (const [owner, other] of [[tenants[0], tenants[1]], [tenants[1], tenants[0]]]) {
    for (const [table, id] of [['profiles', other.id], ['chats', other.chat.id], ['messages', other.message.id], ['knowledge_base', other.faq.id], ['kb_documents', other.doc.id]]) {
      await hidden(owner.client, table, id);
      const result = await owner.client.from(table).update(table === 'profiles' ? { business_name: 'UNAUTHORIZED' } : table === 'messages' ? { text: 'UNAUTHORIZED' } : table === 'chats' ? { customer_name: 'UNAUTHORIZED' } : table === 'knowledge_base' ? { content: 'UNAUTHORIZED' } : { file_name: 'UNAUTHORIZED' }).eq('id', id).select('id');
      assert.ok(result.error || result.data?.length === 0, `${table} cross-tenant update accepted`);
      const deleted = await owner.client.from(table).delete().eq('id', id).select('id');
      assert.ok(deleted.error || deleted.data?.length === 0, `${table} cross-tenant delete accepted`);
      const exists = data(await admin.from(table).select('id').eq('id', id).single(), `${table} retained`);
      assert.equal(exists.id, id);
    }
    await denyInsert(owner.client, 'chats', { business_id: other.id, customer_phone: `verify-denied-${randomUUID()}` });
    await denyInsert(owner.client, 'messages', { chat_id: other.chat.id, sender: 'human', text: 'UNAUTHORIZED' });
    await denyInsert(owner.client, 'knowledge_base', { business_id: other.id, content: 'UNAUTHORIZED' });
    await denyInsert(owner.client, 'kb_documents', { business_id: other.id, file_name: 'unauthorized.txt', file_type: 'TXT', file_size: 1, storage_path: other.path });
    const deniedDownload = await owner.client.storage.from('kb-documents').download(other.path);
    assert.ok(deniedDownload.error, 'Cross-tenant TXT download accepted');
    const deniedPath = `${other.id}/${randomUUID()}-unauthorized.txt`;
    storagePaths.push(deniedPath);
    const deniedUpload = await owner.client.storage.from('kb-documents').upload(deniedPath, new Blob(['x']), { contentType: 'text/plain' });
    assert.ok(deniedUpload.error, 'Cross-tenant TXT upload accepted');
    const deniedReplace = await owner.client.storage.from('kb-documents').upload(other.path, new Blob(['UNAUTHORIZED'], { type: 'text/plain' }), { contentType: 'text/plain', upsert: true });
    assert.ok(deniedReplace.error, 'Cross-tenant TXT replacement accepted');
    assert.equal(await data(await other.client.storage.from('kb-documents').download(other.path), 'cross-tenant replacement retained owner content').text(), 'Updated disposable TXT');
    const deniedList = data(await owner.client.storage.from('kb-documents').list(other.id), 'cross-tenant storage list');
    assert.equal(deniedList.length, 0, 'Cross-tenant object listing exposed');
    const deniedDelete = await owner.client.storage.from('kb-documents').remove([other.path]);
    assert.ok(deniedDelete.error || deniedDelete.data?.length === 0, 'Cross-tenant object delete accepted');
    data(await other.client.storage.from('kb-documents').download(other.path), 'cross-tenant delete retained owner file');
  }
  pass('Both directions: profiles/chats/messages/FAQ/KB read-write-delete RLS isolation');
  pass('Both directions: private TXT download/upload/list ownership isolation');
  for (const [owner, other] of [[tenants[0], tenants[1]], [tenants[1], tenants[0]]]) {
    for (const [table, ownId, otherId] of [
      ['handoff_events', owner.handoff.id, other.handoff.id],
      ['unanswered_questions', owner.unanswered.id, other.unanswered.id],
      ['unanswered_question_occurrences', owner.occurrence.id, other.occurrence.id],
    ]) {
      assert.equal(data(await owner.client.from(table).select('id').eq('id', ownId).single(), 'own auxiliary row').id, ownId);
      await hidden(owner.client, table, otherId);
    }
    data(await owner.client.from('unanswered_questions').update({ status: 'dismissed' }).eq('id', owner.unanswered.id), 'owner dismisses unanswered question');
    assert.ok((await owner.client.from('unanswered_questions').update({ business_id: other.id }).eq('id', owner.unanswered.id)).error, 'Owner cannot reassign unanswered tenant');
    await denyInsert(owner.client, 'handoff_events', { business_id: other.id, chat_id: other.chat.id });
  }
  pass('Handoff and unanswered tables preserve tenant isolation and limited update grants');
  const anon = createClient(url, publicKey, opts);
  for (const [table, id] of [['profiles', tenants[0].id], ['chats', tenants[0].chat.id], ['messages', tenants[0].message.id], ['knowledge_base', tenants[0].faq.id], ['kb_documents', tenants[0].doc.id]]) {
    const result = await anon.from(table).select('id').eq('id', id);
    assert.ok(result.error || result.data?.length === 0, `${table} anonymous read exposed`);
  }
  assert.ok((await anon.storage.from('kb-documents').download(tenants[0].path)).error, 'Anonymous download exposed');
  const anonymousList = await anon.storage.from('kb-documents').list(tenants[0].id);
  assert.ok(anonymousList.error || anonymousList.data?.length === 0, 'Anonymous object listing exposed');
  const anonymousPath = `${tenants[0].id}/${randomUUID()}-anonymous.txt`;
  storagePaths.push(anonymousPath);
  assert.ok((await anon.storage.from('kb-documents').upload(anonymousPath, new Blob(['UNAUTHORIZED'], { type: 'text/plain' }), { contentType: 'text/plain' })).error, 'Anonymous upload accepted');
  const anonymousDelete = await anon.storage.from('kb-documents').remove([tenants[0].path]);
  assert.ok(anonymousDelete.error || anonymousDelete.data?.length === 0, 'Anonymous object delete accepted');
  assert.equal(await data(await tenants[0].client.storage.from('kb-documents').download(tenants[0].path), 'anonymous delete retained owner content').text(), 'Updated disposable TXT');
  pass('Anonymous row reads and private file download/list/upload/delete rejected');
  const messageId = tenants[0].message.id;
  const unauthorizedRpc = await tenants[0].client.rpc('claim_outbound_message', { p_message_id: messageId });
  assert.ok(unauthorizedRpc.error, 'Authenticated user can claim privileged outbound RPC');
  assert.ok((await anon.rpc('claim_outbound_message', { p_message_id: messageId })).error, 'Anonymous can claim outbound RPC');
  assert.ok((await tenants[0].client.rpc('finish_outbound_message', { p_message_id: messageId, p_status: 'sent' })).error, 'Authenticated can finish privileged outbound RPC');
  const claims = await Promise.all(Array.from({ length: 5 }, () => admin.rpc('claim_outbound_message', { p_message_id: messageId })));
  assert.equal(claims.filter((r) => data(r, 'concurrent outbound claim') === true).length, 1);
  data(await admin.rpc('finish_outbound_message', { p_message_id: messageId, p_status: 'failed', p_error: 'Disposable failure' }), 'finish failed');
  assert.equal(data(await admin.rpc('claim_outbound_message', { p_message_id: messageId }), 'reclaim failed'), true);
  data(await admin.rpc('finish_outbound_message', { p_message_id: messageId, p_status: 'sent' }), 'finish sent');
  const sent = data(await admin.from('messages').select('delivery_status,delivery_attempts,last_delivery_error,sent_at').eq('id', messageId).single(), 'read delivery state');
  assert.equal(sent.delivery_status, 'sent'); assert.equal(sent.delivery_attempts, 2); assert.equal(sent.last_delivery_error, null); assert.ok(sent.sent_at);
  assert.equal(data(await admin.rpc('claim_outbound_message', { p_message_id: messageId }), 'sent cannot reclaim'), false);
  pass('Privileged delivery RPC denied to users; five concurrent service claims yield one winner; retry state correct');
  const linked = { chat_id: tenants[0].chat.id, sender: 'bot', text: 'Disposable uniqueness check; never sent', reply_to_external_message_id: `verify-${randomUUID()}`, delivery_status: 'pending' };
  data(await admin.from('messages').insert(linked), 'first linked reply');
  const duplicate = await admin.from('messages').insert(linked);
  assert.equal(duplicate.error?.code, '23505');
  pass('Database rejects duplicate linked bot reply');
  const humanRequestId = randomUUID();
  const humanRow = { chat_id: tenants[0].chat.id, sender: 'human', text: 'Disposable idempotency check; never sent', client_request_id: humanRequestId, delivery_status: 'pending' };
  const insertedHumans = await Promise.all(Array.from({ length: 5 }, () => admin.from('messages').insert(humanRow).select('id')));
  assert.equal(insertedHumans.filter(r => !r.error).length, 1);
  assert.equal(insertedHumans.filter(r => r.error?.code === '23505').length, 4);
  pass('Database unique request index accepts only one of five concurrent human inserts');
  const promotion = await tenants[0].client.from('profiles').update({ role: 'admin' }).eq('id', tenants[0].id);
  assert.ok(promotion.error, 'Tenant self-promotion was accepted');
  const profile = data(await admin.from('profiles').select('role').eq('id', tenants[0].id).single(), 'role retained');
  assert.equal(profile.role, 'sme');
  pass('Authenticated tenant cannot self-promote to admin');

  for (const tenant of tenants) {
    data(await admin.from('whatsapp_connections').insert({
      business_id: tenant.id,
      phone_number_id: `disposable-${randomUUID()}`,
      verify_token: randomBytes(32).toString('hex'),
      access_token_encrypted: 'disposable-ciphertext-never-used',
      app_secret_encrypted: 'disposable-ciphertext-never-used',
    }), 'insert local WhatsApp fixture');
    const safe = data(await tenant.client.from('whatsapp_connections').select('business_id,connection_status').eq('business_id', tenant.id).single(), 'safe WhatsApp metadata');
    assert.equal(safe.business_id, tenant.id);
    for (const column of ['verify_token', 'access_token', 'access_token_encrypted', 'app_secret_encrypted']) {
      assert.ok((await tenant.client.from('whatsapp_connections').select(column)).error, 'Credential column must be denied');
    }
    assert.ok((await tenant.client.from('internal_settings').select('key,value')).error, 'Internal settings must be denied');
    const keys = await tenant.client.from('platform_api_keys').select('id');
    assert.ok(keys.error || keys.data?.length === 0, 'SME must not see admin API keys');
  }
  assert.ok((await anon.from('internal_settings').select('key,value')).error, 'Anonymous internal settings must be denied');
  const internalToken = data(await admin.from('internal_settings').select('value').eq('key', 'weekly_report_token').single(), 'service hook token');
  assert.match(internalToken.value, /^[a-f0-9]{64}$/);
  pass('Credential columns and internal hook secret denied to users; service role retains access');

  for (const tenant of tenants) {
    const removed = data(await tenant.client.storage.from('kb-documents').remove([tenant.path]), 'delete own private object');
    assert.equal(removed.length, 1, 'Owner must delete own object');
    assert.ok((await tenant.client.storage.from('kb-documents').download(tenant.path)).error, 'Deleted file remained readable');
  }
  pass('Owners can replace and delete their own private files');

} catch (error) {
  console.error(`FAIL disposable verification: ${error instanceof assert.AssertionError ? error.message : error?.message || 'unspecified error'}`);
  failed = true;
} finally {
  let clean = true;
  if (storagePaths.length) {
    const removed = await admin.storage.from('kb-documents').remove(storagePaths);
    if (removed.error) { clean = false; console.error('FAIL cleanup private verification objects'); }
  }
  for (const tenant of tenants) {
    for (const table of ['unanswered_question_occurrences', 'unanswered_questions', 'knowledge_base', 'kb_documents', 'chats']) {
      const result = await admin.from(table).delete().eq('business_id', tenant.id);
      if (result.error) { clean = false; console.error(`FAIL cleanup own ${table}`); }
    }
    const signedOut = await tenant.client.auth.signOut();
    if (signedOut.error) { clean = false; console.error('FAIL revoke disposable session'); }
    const deleted = await admin.auth.admin.deleteUser(tenant.id);
    if (deleted.error) { clean = false; console.error('FAIL cleanup disposable user'); }
  }
  if (!clean) failed = true;
  else console.log('PASS cleanup only disposable tenants and verification objects');
  console.log(`RESULT ${checks} verification groups; ${failed ? 'FAIL' : 'PASS'}`);
}

if (failed) throw new Error('Disposable Supabase API verification failed; see sanitized checks above');
return { groups: checks, passed: true };

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv[2], '--config', 'Usage: node tests/disposable-rls.test.mjs --config /tmp/private-config.json');
    assert.ok(process.argv[3], 'Config file required');
    await runDisposableSupabaseChecks(JSON.parse(readFileSync(process.argv[3], 'utf8')));
  } catch (error) {
    // Never print config objects, tokens, response bodies or stack traces.
    console.error(error instanceof assert.AssertionError ? error.message : 'FAIL disposable Supabase verification');
    process.exitCode = 1;
  }
}
