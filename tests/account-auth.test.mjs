import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { handleAccountRequest } from '../src/lib/account-http.server.ts';
import { authenticateAccount, readAccount, revokeAccountSessions, updateAccount, accountProfile } from '../src/lib/account-store.server.ts';

test('independent accounts work without Supabase and enforce server sessions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lokalchat-account-test-'));
  const previous = process.env.LOKALCHAT_ACCOUNT_DB;
  process.env.LOKALCHAT_ACCOUNT_DB = join(directory, 'accounts.sqlite');
  t.after(async () => { if (previous === undefined) delete process.env.LOKALCHAT_ACCOUNT_DB; else process.env.LOKALCHAT_ACCOUNT_DB = previous; await rm(directory, { recursive: true, force: true }); });
  const password = 'Local-only-test-password-234!';
  const email = 'owner@example.test';
  const http = (data, cookie, origin = 'http://localhost', url = 'http://localhost/api/account') => handleAccountRequest(new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) }));

  await t.test('rejects cross-origin and unauthenticated settings writes', async () => {
    assert.equal((await http({ action: 'signup', email, password }, undefined, 'https://attacker.test')).status, 403);
    assert.equal((await http({ action: 'update', data: { full_name: 'Attacker' } })).status, 401);
    const response = await handleAccountRequest(new Request('http://localhost/api/account'));
    assert.deepEqual(await response.json(), { user: null });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  let token, first, cookie;
  await t.test('registers with private hashed credentials and an HttpOnly cookie', async () => {
    const response = await http({ action: 'signup', email, password, businessName: 'Kedai Ujian' });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    token = cookie.split('=')[1];
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    first = (await response.json()).user;
    assert.equal(first.email, email);
    assert.equal(accountProfile(first.id).business_name, 'Kedai Ujian');
    const raw = await readFile(process.env.LOKALCHAT_ACCOUNT_DB);
    assert.equal(raw.includes(password), false);
    assert.equal(raw.includes(token), false);
    assert.equal((await stat(process.env.LOKALCHAT_ACCOUNT_DB)).mode & 0o777, 0o600);
    assert.equal(readAccount(token).id, first.id);
    assert.equal(readAccount(token + 'tampered'), null);
    const validShape = 'x'.repeat(43);
    assert.equal(readAccount(validShape), null);
    const session = await handleAccountRequest(new Request('http://localhost/api/account', { headers: { cookie } }));
    assert.equal((await session.json()).user.id, first.id);
  });

  await t.test('rejects duplicate registration and incorrect passwords', async () => {
    await assert.rejects(authenticateAccount({ email, password }, true), /Pendaftaran/);
    await assert.rejects(authenticateAccount({ email, password: 'incorrect-password' }, false), /Emel atau/);
    await assert.rejects(authenticateAccount({ email: 'nobody@example.test', password }, false), /Emel atau/);
    await assert.rejects(authenticateAccount({ email: 'invalid', password }, true), /alamat emel/);
    await assert.rejects(authenticateAccount({ email: 'short@example.test', password: '123' }, true), /8 hingga 256/);
  });

  let second;
  await t.test('signs in case-insensitively, isolates profiles and rotates prior session', async () => {
    second = await authenticateAccount({ email: email.toUpperCase(), password }, false);
    assert.equal(second.user.id, first.id);
    const other = await authenticateAccount({ email: 'second@example.test', password }, true);
    accountProfile(first.id, { business_name: 'Changed' });
    assert.notEqual(accountProfile(other.user.id).business_name, 'Changed');
    const rotated = await authenticateAccount({ email: 'second@example.test', password }, false, other.token);
    assert.equal(readAccount(other.token), null);
    assert.ok(readAccount(rotated.token));
    revokeAccountSessions(second.token, 'others');
    assert.equal(readAccount(token), null);
    assert.ok(readAccount(second.token));
  });

  await t.test('password changes require the current password and revoke other sessions', async () => {
    await assert.rejects(updateAccount(second.token, { password: 'new-secret-password' }), /semasa/);
    const extra = await authenticateAccount({ email, password }, false);
    const updated = await updateAccount(second.token, { current_password: password, password: 'new-secret-password', data: { full_name: 'Owner', role: 'admin' } });
    assert.equal(updated.user_metadata.full_name, 'Owner');
    assert.equal(updated.user_metadata.role, undefined);
    assert.equal(readAccount(extra.token), null);
    await assert.rejects(authenticateAccount({ email, password }, false), /Emel atau/);
    assert.equal((await authenticateAccount({ email, password: 'new-secret-password' }, false)).user.id, first.id);
  });

  await t.test('expired sessions fail and global signout revokes every session', async () => {
    const db = new DatabaseSync(process.env.LOKALCHAT_ACCOUNT_DB);
    db.prepare('UPDATE sessions SET expires = 0 WHERE token_hash = ?').run(createHash('sha256').update(second.token).digest('hex'));
    db.close();
    assert.equal(readAccount(second.token), null);
    const current = await authenticateAccount({ email: 'second@example.test', password }, false);
    const another = await authenticateAccount({ email: 'second@example.test', password }, false);
    const response = await http({ action: 'signout', scope: 'global' }, 'lokalchat_session=' + current.token);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(readAccount(current.token), null);
    assert.equal(readAccount(another.token), null);
  });

  await t.test('HTTPS cookies are secure and repeated failed logins are throttled', async () => {
    const response = await http({ action: 'signup', email: 'secure@example.test', password }, undefined, 'https://localhost', 'https://localhost/api/account');
    assert.match(response.headers.get('set-cookie'), /; Secure/);
    for (let i = 0; i < 10; i++) await assert.rejects(authenticateAccount({ email: 'rate@example.test', password }, false));
    const limited = await http({ action: 'signin', email: 'rate@example.test', password });
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /Terlalu banyak/);
  });
});
