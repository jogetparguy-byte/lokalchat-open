/** Run only against the authorized staging project. Never logs credentials. */
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
if (process.env.STAGING_ENV_FILE) process.loadEnvFile(process.env.STAGING_ENV_FILE);
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && publicKey && serviceKey, 'Required staging environment missing');
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, opts);
const tenants = [];
const storagePaths = [];
let checks = 0;
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
    const created = data(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { business_name: 'Disposable LokalChat verification' } }), 'create disposable user');
    const tenant = { id: created.user.id, client: createClient(url, publicKey, opts), label };
    tenants.push(tenant);
    data(await tenant.client.auth.signInWithPassword({ email, password }), 'sign in disposable user');
    const own = data(await tenant.client.from('profiles').select('id').eq('id', tenant.id), 'own profile');
    assert.equal(own[0]?.id, tenant.id);
    tenant.chat = data(await tenant.client.from('chats').insert({ business_id: tenant.id, customer_phone: `verify-${randomUUID()}`, customer_name: 'Disposable RLS test', is_bot_active: false }).select('id').single(), 'create own chat');
    tenant.message = data(await tenant.client.from('messages').insert({ chat_id: tenant.chat.id, sender: 'human', text: 'Disposable RLS verification; never sent', delivery_status: 'failed' }).select('id').single(), 'create own message');
    tenant.faq = data(await tenant.client.from('knowledge_base').insert({ business_id: tenant.id, content: 'Disposable verification FAQ' }).select('id').single(), 'create own FAQ');
    const path = `${tenant.id}/${randomUUID()}-verification.txt`;
    storagePaths.push(path);
    data(await tenant.client.storage.from('kb-documents').upload(path, new Blob(['Disposable verification TXT'], { type: 'text/plain' }), { contentType: 'text/plain', upsert: false }), 'upload own TXT');
    tenant.doc = data(await tenant.client.from('kb_documents').insert({ business_id: tenant.id, file_name: 'verification.txt', file_type: 'TXT', file_size: 27, storage_path: path }).select('id').single(), 'create own KB metadata');
    tenant.path = path;
    const downloaded = data(await tenant.client.storage.from('kb-documents').download(path), 'download own TXT');
    assert.equal(await downloaded.text(), 'Disposable verification TXT');
  }
  pass('Two real authenticated users can manage their own rows and private TXT files');
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
    const deniedList = data(await owner.client.storage.from('kb-documents').list(other.id), 'cross-tenant storage list');
    assert.equal(deniedList.length, 0, 'Cross-tenant object listing exposed');
  }
  pass('Both directions: profiles/chats/messages/FAQ/KB read-write-delete RLS isolation');
  pass('Both directions: private TXT download/upload/list ownership isolation');
  const anon = createClient(url, publicKey, opts);
  for (const [table, id] of [['profiles', tenants[0].id], ['chats', tenants[0].chat.id], ['messages', tenants[0].message.id], ['knowledge_base', tenants[0].faq.id], ['kb_documents', tenants[0].doc.id]]) {
    const result = await anon.from(table).select('id').eq('id', id);
    assert.ok(result.error || result.data?.length === 0, `${table} anonymous read exposed`);
  }
  assert.ok((await anon.storage.from('kb-documents').download(tenants[0].path)).error, 'Anonymous download exposed');
  pass('Anonymous reads and private file download rejected');
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

} catch (error) {
  console.error(`FAIL staging verification: ${error instanceof assert.AssertionError ? error.message : error?.message || 'unspecified error'}`);
  process.exitCode = 1;
} finally {
  let clean = true;
  if (storagePaths.length) {
    const removed = await admin.storage.from('kb-documents').remove(storagePaths);
    if (removed.error) { clean = false; console.error('FAIL cleanup private verification objects'); }
  }
  for (const tenant of tenants) {
    for (const table of ['knowledge_base', 'kb_documents', 'chats']) {
      const result = await admin.from(table).delete().eq('business_id', tenant.id);
      if (result.error) { clean = false; console.error(`FAIL cleanup own ${table}`); }
    }
    const deleted = await admin.auth.admin.deleteUser(tenant.id);
    if (deleted.error) { clean = false; console.error('FAIL cleanup disposable user'); }
  }
  if (!clean) process.exitCode = 1;
  else console.log('PASS cleanup only disposable tenants and verification objects');
  console.log(`RESULT ${checks} verification groups; ${process.exitCode ? 'FAIL' : 'PASS'}`);
}
