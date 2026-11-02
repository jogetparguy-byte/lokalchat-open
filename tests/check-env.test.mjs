import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../scripts/check-env.mjs';

const valid = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_dummy',
};
test('offline setup accepts matching development configuration', () => {
  assert.deepEqual(validateEnvironment(valid), []);
});
test('offline setup rejects placeholders and mismatched projects', () => {
  assert.ok(validateEnvironment({ ...valid, SUPABASE_URL: 'https://REPLACE_ME.supabase.co' }).length);
  assert.ok(validateEnvironment({ ...valid, SUPABASE_URL: 'https://other.supabase.co' }).some(error => error.includes('same project')));
});
test('offline setup rejects privileged public keys without printing values', () => {
  const jwt = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.dummy-signature`;
  for (const key of ['sb_secret_dummy', jwt]) {
    const errors = validateEnvironment({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key });
    assert.ok(errors.some(error => error.includes('privileged')));
    assert.ok(errors.every(error => !error.includes(key)));
  }
  assert.ok(validateEnvironment({ ...valid, VITE_AI_API_SECRET: 'dummy' }).some(error => error.includes('privileged')));
  assert.ok(validateEnvironment({ ...valid, VITE_OPENAI_API_KEY: 'dummy' }).some(error => error.includes('privileged')));
});
test('offline setup rejects URLs with credentials or insecure remote transport', () => {
  for (const url of ['https://user:password@example.com', 'http://remote.example.com', 'https://example.com/path', 'invalid']) {
    assert.ok(validateEnvironment({ ...valid, SUPABASE_URL: url }).some(error => error.includes('origin')));
  }
});
