import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAccountRequest } from '../src/lib/account-http.server.ts';
import { parseOnboarding } from '../src/lib/onboarding.ts';

const answers = { full_name: ' Alex Morgan ', team_size: '2–10 people', use_case: 'Customer support', referral_source: 'GitHub or npm' };
test('onboarding rejects malformed answers and strips unrelated metadata', () => {
  assert.equal(parseOnboarding(undefined), undefined);
  for (const invalid of [null, [], 'text', {}, { ...answers, full_name: ' ' }, { ...answers, full_name: 'x'.repeat(161) }, { ...answers, team_size: 'invalid' }, { ...answers, use_case: 42 }, { ...answers, referral_source: {} }]) {
    assert.throws(() => parseOnboarding(invalid), /Maklumat akaun/);
  }
  assert.deepEqual(parseOnboarding({ ...answers, role: 'admin', password: 'never-store' }), { ...answers, full_name: 'Alex Morgan' });
});
test('signup persists onboarding atomically per account and retains it on sign in', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lokalchat-onboarding-'));
  const previous = process.env.LOKALCHAT_ACCOUNT_DB;
  process.env.LOKALCHAT_ACCOUNT_DB = join(directory, 'accounts.sqlite');
  t.after(async () => {
    if (previous === undefined) delete process.env.LOKALCHAT_ACCOUNT_DB; else process.env.LOKALCHAT_ACCOUNT_DB = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const password = 'Test-only-password-372!';
  const post = body => handleAccountRequest(new Request('http://localhost/api/account', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const invalid = await post({ action: 'signup', email: 'new@example.test', password, onboarding: { ...answers, team_size: 'bad' } });
  assert.equal(invalid.status, 400);
  const created = await post({ action: 'signup', email: 'new@example.test', password, businessName: 'Example Shop', onboarding: { ...answers, role: 'admin' } });
  assert.equal(created.status, 200);
  const user = (await created.json()).user;
  assert.deepEqual(user.user_metadata, { business_name: 'Example Shop', ...answers, full_name: 'Alex Morgan' });
  const login = await post({ action: 'signin', email: 'new@example.test', password });
  assert.deepEqual((await login.json()).user.user_metadata, user.user_metadata);
  const other = await post({ action: 'signup', email: 'other@example.test', password });
  assert.equal((await other.json()).user.user_metadata.full_name, undefined);
  assert.equal((await readFile(process.env.LOKALCHAT_ACCOUNT_DB)).includes(password), false);
});
