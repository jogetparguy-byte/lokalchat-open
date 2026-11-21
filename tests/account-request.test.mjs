import assert from 'node:assert/strict';
import test from 'node:test';
import { bindAccountRequest } from '../src/lib/account-request.ts';
import { setAccountIdentity } from '../src/lib/account-identity.ts';

test('old mounted operations cannot send drafts under a replacement account', async () => {
  let calls = 0;
  setAccountIdentity('account-a');
  const oldRequest = bindAccountRequest(async () => { calls++; }, 'account-a');
  setAccountIdentity('account-b');
  assert.throws(() => oldRequest({ data: { text: 'A private draft' } }), /Akaun telah berubah/);
  assert.equal(calls, 0);
  setAccountIdentity(null);
  assert.throws(() => oldRequest(), /Akaun telah berubah/);
  assert.equal(calls, 0);
});

test('already-started requests retain the original owner when middleware resumes after switching accounts', async () => {
  let resume;
  const delay = new Promise(resolve => { resume = resolve; });
  setAccountIdentity('account-a');
  const request = bindAccountRequest(async options => {
    await delay;
    return { owner: options.headers.get('x-lokalchat-account'), requestId: options.headers.get('x-request-id'), data: options.data };
  }, 'account-a');
  const result = request({ data: { text: 'A private draft' }, headers: { 'x-lokalchat-account': 'injected-owner', 'x-request-id': 'original' } });
  setAccountIdentity('account-b');
  resume();
  assert.deepEqual(await result, { owner: 'account-a', requestId: 'original', data: { text: 'A private draft' } });
  setAccountIdentity(null);
});

test('new account requests and header-only GET calls use their mounted identity', async () => {
  setAccountIdentity('account-b');
  const request = bindAccountRequest(async options => options.headers.get('x-lokalchat-account'), 'account-b');
  assert.equal(await request(), 'account-b');
  setAccountIdentity(null);
});
