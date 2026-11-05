import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPublicConfig } from '../src/lib/public-config.ts';

test('fresh-install public placeholders and malformed URLs cannot enable auth', () => {
  for (const [url, key] of [
    [undefined, undefined],
    ['https://REPLACE_ME.supabase.co', 'REPLACE_ME_PUBLIC_PUBLISHABLE_KEY'],
    ['https://example.supabase.co', 'REPLACE_ME_PUBLIC_PUBLISHABLE_KEY'],
    ['not a url', 'public-test'],
    ['file:///tmp/database', 'public-test'],
  ]) assert.equal(hasPublicConfig(url, key), false);
  assert.equal(hasPublicConfig('http://127.0.0.1:54321', 'local-public-test'), true);
  assert.equal(hasPublicConfig('https://example.supabase.co', 'sb_publishable_test'), true);
});
