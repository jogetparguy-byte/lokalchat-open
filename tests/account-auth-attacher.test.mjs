import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { hasPublicConfig } from '../src/lib/public-config.ts';

const source = readFileSync(new URL('../src/lib/account-auth-attacher.ts', import.meta.url), 'utf8');
function middleware(env, token) {
  let handler;
  let reads = 0;
  const context = {
    exports: {}, env,
    require(name) {
      if (name === '@tanstack/react-start') return { createMiddleware: () => ({ client(fn) { handler = fn; } }) };
      if (name === './public-config') return { hasPublicConfig };
      if (name === '@/integrations/supabase/client') return {
        supabase: { get auth() {
          reads++;
          assert.ok(env.VITE_SUPABASE_URL, 'unconfigured RPC must not initialize Supabase');
          return { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) };
        } },
      };
      throw new Error('Unexpected import: ' + name);
    },
  };
  const code = ts.transpileModule(source.replaceAll('import.meta.env', 'env'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, context);
  return { run: () => handler({ next: options => options }), reads: () => reads };
}

test('cookie-auth RPC proceeds without initializing an unconfigured Supabase client', async () => {
  for (const env of [{}, { VITE_SUPABASE_URL: 'https://REPLACE_ME.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'REPLACE_ME' }]) {
    const rpc = middleware(env);
    assert.equal(await rpc.run(), undefined);
    assert.equal(rpc.reads(), 0);
  }
});

test('configured hosted accounts retain bearer authentication', async () => {
  const env = { VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
  const rpc = middleware(env, 'test-access-token');
  assert.equal((await rpc.run()).headers.Authorization, 'Bearer test-access-token');
  assert.equal(rpc.reads(), 1);
  assert.equal(Object.keys((await middleware(env).run()).headers).length, 0);
});
