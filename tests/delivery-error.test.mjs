import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(relative, require = () => { throw new Error('Unexpected import'); }, globals = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require, Set, console: { error() {}, info() {} }, process: { env: {} }, AbortSignal, ...globals });
  return module.exports;
}
const errors = load('../src/lib/delivery-error.ts');

test('legacy and arbitrary delivery errors never reveal credential formats', () => {
  for (const secret of ['Bearer sample-token', 'access_token=sample', 'api_key=sample', 'postgres://user:password@host/db', 'eyJhbGciOi.fake.jwt', '<script>secret</script>', 'HTTP 401: secret', { token: 'sample' }]) {
    assert.equal(errors.safeDeliveryError(secret), errors.DELIVERY_ERRORS.failed);
  }
  assert.equal(errors.safeDeliveryError(null), null);
  assert.equal(errors.safeDeliveryError(undefined), null);
  assert.equal(errors.safeDeliveryError(''), null);
});

test('only exact public messages are retained without appended data', () => {
  for (const message of Object.values(errors.DELIVERY_ERRORS)) {
    assert.equal(errors.safeDeliveryError(message), message);
    assert.equal(errors.safeDeliveryError(message + ' token=sample'), errors.DELIVERY_ERRORS.failed);
  }
});

function transportHarness(status, throwing = false) {
  const updates = [];
  const builder = { select() { return this; }, eq() { return this; }, update(value) { updates.push(value); return this; }, async maybeSingle() { return { data: { phone_number_id: 'phone', access_token_encrypted: 'encrypted' } }; } };
  const transport = load('../src/lib/whatsapp.server.ts', name => {
    if (name === '@/integrations/supabase/client.server') return { supabaseAdmin: { from() { return builder; } } };
    if (name === './wa-crypto.server') return { decryptSecret() { return 'sample-secret'; } };
    if (name === './delivery-error') return errors;
    throw new Error('Unexpected import: ' + name);
  }, { fetch: async () => {
    if (throwing) throw new Error('Bearer sample-secret https://user:password@host');
    return { ok: false, status, async text() { throw new Error('Raw response body must not be read'); } };
  } });
  return { transport, updates };
}

test('provider failure stores and returns fixed public errors without reading response bodies', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const { transport, updates } = transportHarness(status);
    const result = await transport.sendWhatsAppMessage('customer', 'reply', 'owner');
    assert.equal(result.ok, false);
    assert.equal(result.error, errors.deliveryErrorForStatus(status));
    if (status === 401 || status === 403) assert.equal(updates[0].last_error_message, errors.DELIVERY_ERRORS.authorization);
  }
});

test('transport exceptions cannot expose credential-bearing error messages', async () => {
  const { transport } = transportHarness(0, true);
  const result = await transport.sendWhatsAppMessage('customer', 'reply', 'owner');
  assert.equal(result.error, errors.DELIVERY_ERRORS.failed);
  assert.equal(JSON.stringify(result).includes('sample-secret'), false);
});
