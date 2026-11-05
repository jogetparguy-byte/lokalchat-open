import { usePreferences } from "../src/components/lokalchat/usePreferences.ts";
import { useSettingsDirty } from "../src/components/lokalchat/SettingsDirtyContext.tsx";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { envPath } from '../src/lib/env-file.server.ts';
import { parseEnv } from 'node:util';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as ReactQuery from '@tanstack/react-query';
import { Input } from '../src/components/ui/input.tsx';
import { Label } from '../src/components/ui/label.tsx';
import { Button } from '../src/components/ui/button.tsx';
import * as validation from '../src/lib/supabase-settings.ts';
import { getSupabaseEnvSettings, saveSupabaseEnvSettings } from '../src/lib/supabase-env.server.ts';
import { saveLlmEnvSettings } from '../src/lib/llm-env.server.ts';
const { validateSupabaseSettings } = validation;
const userId = '11111111-1111-4111-8111-111111111111';
const input = { projectUrl: 'https://fixture.supabase.co', publicKey: 'sb_publishable_test_fixture', secretKey: 'sb_secret_test_fixture' };
const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role})).toString('base64url')}.fixture`;
async function fixture(t, content = '') {
  const dir = await mkdtemp(join(tmpdir(), 'lokalchat-supabase-settings-'));
  const old = process.env.LOKALCHAT_USER_ENV_DIR;
  process.env.LOKALCHAT_USER_ENV_DIR = dir;
  const file = envPath(userId);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  t.after(async () => {
    if (old === undefined) delete process.env.LOKALCHAT_USER_ENV_DIR; else process.env.LOKALCHAT_USER_ENV_DIR = old;
    await rm(dir, {recursive: true, force: true});
  });
  return {dir, file};
}

test('accepts modern and correctly scoped legacy API keys, HTTPS projects and local HTTP', () => {
  assert.deepEqual(validateSupabaseSettings(input), input);
  assert.equal(validateSupabaseSettings({...input, projectUrl: 'http://127.0.0.1:54321/'}).projectUrl, 'http://127.0.0.1:54321');
  assert.equal(validateSupabaseSettings({...input, publicKey: jwt('anon'), secretKey: jwt('service_role')}).secretKey, jwt('service_role'));
});

test('rejects privileged public keys, swapped scopes, malformed URLs and env injection without echoing input', () => {
  const bad = [null, {}, {...input, projectUrl: 1}, {...input, publicKey: input.secretKey}, {...input, publicKey: jwt('service_role')}, {...input, secretKey: input.publicKey}, {...input, publicKey: jwt('authenticated')}, {...input, secretKey: 'invalid'}, {...input, publicKey: 'sb_publishable_'},
    ...['http://remote.example', 'https://user:password@example.com', 'https://example.com/rest/v1', 'https://example.com/?q=secret', 'https://example.com/#hash', "https://example.com/'", 'https://example.com/\nEVIL=1'].map(projectUrl => ({...input, projectUrl})),
    ...["sb_secret_bad'", 'sb_secret_bad\nVITE_LEAK=1', 'REPLACE_ME', 'sb_secret_' + 'x'.repeat(4096)].map(secretKey => ({...input, secretKey}))];
  for (const data of bad) assert.throws(() => validateSupabaseSettings(data), error => !error.message.includes('test_fixture') && !error.message.includes('VITE_LEAK=1'));
});

test('writes consistent browser/server settings atomically and preserves unrelated and multiline values', async t => {
  const original = '# preserve\nAI_API_KEY=sk-llm-fixture\nWHATSAPP_CRYPTO_KEY=retain\nOTHER="hello\nSUPABASE_URL=inside-another-value\nworld"\nSUPABASE_URL=duplicate\nexport SUPABASE_URL=duplicate2\n';
  const {file} = await fixture(t, original);
  const result = await saveSupabaseEnvSettings(userId, input);
  const raw = await readFile(file, 'utf8'), saved = parseEnv(raw);
  assert.equal(saved.SUPABASE_URL, input.projectUrl);
  assert.equal(saved.VITE_SUPABASE_URL, input.projectUrl);
  assert.equal(saved.VITE_SUPABASE_PUBLISHABLE_KEY, input.publicKey);
  assert.equal(saved.SUPABASE_PUBLISHABLE_KEY, input.publicKey);
  assert.equal(saved.SUPABASE_SERVICE_ROLE_KEY, input.secretKey);
  assert.equal(saved.SUPABASE_CONFIG_SOURCE, 'settings');
  for (const name of ['AI_API_KEY', 'WHATSAPP_CRYPTO_KEY', 'OTHER']) assert.equal(saved[name], parseEnv(original)[name]);
  assert.ok(raw.startsWith('# preserve\n'));
  assert.equal(raw.includes('duplicate'), false);
  for (const [name, value] of Object.entries(saved)) if (name.startsWith('VITE_')) assert.ok(!value.includes(input.secretKey));
  for (const data of [result, await getSupabaseEnvSettings(userId)]) {
    assert.equal(data.hasSecretKey, true); assert.equal(data.hasPublicKey, true);
    assert.equal(JSON.stringify(data).includes(input.secretKey), false);
    assert.equal(JSON.stringify(data).includes(input.publicKey), false);
  }
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('retains keys only for the same project; changed projects require a complete new pair', async t => {
  const {file} = await fixture(t);
  await saveSupabaseEnvSettings(userId, input);
  await saveSupabaseEnvSettings(userId, {...input, publicKey: '', secretKey: ''});
  await saveSupabaseEnvSettings(userId, {...input, publicKey: 'sb_publishable_rotated', secretKey: ''});
  assert.equal(parseEnv(await readFile(file, 'utf8')).SUPABASE_SERVICE_ROLE_KEY, input.secretKey);
  const before = await readFile(file, 'utf8');
  for (const keys of [{publicKey: '', secretKey: ''}, {publicKey: input.publicKey, secretKey: ''}, {publicKey: '', secretKey: input.secretKey}]) {
    await assert.rejects(saveSupabaseEnvSettings(userId, {...input, projectUrl: 'https://another.supabase.co', ...keys}), /kedua-dua/);
    assert.equal(await readFile(file, 'utf8'), before);
  }
});

test('per-owner settings do not change process credentials or request a global restart', async t => {
  await fixture(t);
  const original = { ...process.env };
  const result = await saveSupabaseEnvSettings(userId, input);
  assert.equal(result.requiresRestart, false);
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) assert.equal(process.env[name], original[name]);
  assert.equal((await getSupabaseEnvSettings(userId)).projectUrl, input.projectUrl);
});

test('one owner lock protects LLM and Supabase writes without blocking another owner', async t => {
  const {file} = await fixture(t);
  await saveSupabaseEnvSettings(userId, input);
  await saveLlmEnvSettings(userId, {provider: 'deepseek', apiKey: 'sk-llm-fixture', model: 'fixture-model', baseUrl: ''});
  await saveSupabaseEnvSettings(userId, {...input, secretKey: 'sb_secret_rotated'});
  assert.equal(parseEnv(await readFile(file, 'utf8')).AI_API_KEY, 'sk-llm-fixture');
  await writeFile(`${file}.settings.lock`, 'another writer');
  await assert.rejects(saveSupabaseEnvSettings(userId, input), /sedang disimpan/);
  await assert.rejects(saveLlmEnvSettings(userId, {provider: 'deepseek', apiKey: 'sk-llm-fixture', model: 'fixture-model', baseUrl: ''}), /sedang disimpan/);
  await saveSupabaseEnvSettings('22222222-2222-4222-8222-222222222222', {...input, secretKey: 'sb_secret_other'});
  assert.equal(await readFile(`${file}.settings.lock`, 'utf8'), 'another writer');
});

test('symlinks and malformed env fail without replacing operator files', async t => {
  const {dir, file} = await fixture(t, 'UNRELATED="unfinished\n');
  await assert.rejects(saveSupabaseEnvSettings(userId, input), /Gagal menyimpan/);
  assert.equal(await readFile(file, 'utf8'), 'UNRELATED="unfinished\n');
  const alias = join(dir, 'alias'); await symlink(dir, alias);
  process.env.LOKALCHAT_USER_ENV_DIR = alias;
  await assert.rejects(saveSupabaseEnvSettings(userId, input), /Gagal menyimpan/);
});

function loadModule(relative, dependencies, globals = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const module = {exports: {}};
  vm.runInNewContext(code, {module, exports: module.exports, require(name) {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, process, console, URL, ...globals});
  return module.exports;
}
function handlers(role, options = {}) {
  let reads = 0, writes = 0;
  const context = { userId: 'verified-account', supabase: { from() { if (options.forbidProfileRead) assert.fail('Supabase settings must not query admin roles'); return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: role ? { role } : null, error: options.dbError ? { message: 'db-fixture' } : null }; } }; } } };
  // Exercise the real auth boundary with a stubbed Auth service, not a profile role.
  const { requireSupabaseAuth } = loadModule('../src/integrations/supabase/auth-middleware.ts', {
    '@tanstack/react-start': { createMiddleware: () => ({ server: fn => fn }) },
    '@tanstack/react-start/server': { getRequest: () => ({ headers: new Headers(options.noLogin ? {} : { authorization: 'Bearer fixture.jwt.token' }) }) },
    '@supabase/supabase-js': { createClient: () => ({ auth: { getClaims: async () => options.invalidToken
      ? { data: null, error: new Error('invalid token') }
      : { data: { claims: { sub: context.userId } }, error: null } } }) },
  }, { process: { env: { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key' } } });
  const api = loadModule('../src/lib/lokalchat.functions.ts', {
    '@tanstack/react-start': { createServerFn() {
      let validator = value => value;
      return { middleware(items) { assert.equal(items.length, 1); assert.equal(items[0], requireSupabaseAuth); return this; }, inputValidator(fn) { validator = fn; return this; }, handler(fn) { return async (input = {}) => requireSupabaseAuth({ next: async () => fn({ context, data: await validator(input.data) }) }); } };
    } },
    '@/integrations/supabase/auth-middleware': { requireSupabaseAuth }, './metrics': {}, './delivery-error': {},
    './supabase-settings': validation,
    './supabase-env.server': {
      getSupabaseEnvSettings: async owner => { assert.equal(owner, context.userId); reads++; return { hasPublicKey: true, hasSecretKey: true }; },
      saveSupabaseEnvSettings: async owner => { assert.equal(owner, context.userId); writes++; return { hasPublicKey: true, hasSecretKey: true }; },
    },
  });
  return { api, get reads() { return reads; }, get writes() { return writes; } };
}

test('signed-in users can read and save Supabase settings without an admin role or profile lookup', async () => {
  for (const role of ['sme', null, 'admin']) {
    const h = handlers(role, { dbError: true, forbidProfileRead: true });
    assert.equal((await h.api.getSupabaseSettings()).canManage, true);
    assert.equal((await h.api.saveSupabaseSettings({ data: input })).canManage, true);
    assert.equal(h.reads, 1); assert.equal(h.writes, 1);
  }
});

test('missing login and invalid tokens cannot read or write Supabase settings', async () => {
  for (const options of [{ noLogin: true }, { invalidToken: true }]) {
    const h = handlers('sme', options);
    await assert.rejects(h.api.getSupabaseSettings(), /Unauthorized/);
    await assert.rejects(h.api.saveSupabaseSettings({ data: input }), /Unauthorized/);
    assert.equal(h.reads, 0);
    assert.equal(h.writes, 0);
  }
});


test('ordinary user can save but privileged browser credentials never reach storage', async () => {
  const h = handlers('sme');
  assert.equal((await h.api.getSupabaseSettings()).canManage, true);
  await h.api.saveSupabaseSettings({data: {...input, userId: 'forged-other-account'}});
  assert.equal(h.writes, 1);
  await assert.rejects(h.api.saveSupabaseSettings({data: {...input, publicKey: input.secretKey}}));
  assert.equal(h.writes, 1);
});

const {SupabaseSettingsSection} = loadModule('../src/components/lokalchat/SupabaseSettingsSection.tsx', {
  'react': React, 'react/jsx-runtime': jsxRuntime, '@tanstack/react-query': ReactQuery,
  '@/services/api': {useApi: fn => fn, getSupabaseSettings: async () => ({}), saveSupabaseSettings: async () => ({})},
  '@/lib/supabase-settings': validation,
  '@/components/lokalchat/usePreferences': {usePreferences}, './SettingsDirtyContext': {useSettingsDirty},
  '@/components/ui/input': {Input}, '@/components/ui/label': {Label}, '@/components/ui/button': {Button},
});
function renderSettings(data) {
  const client = new ReactQuery.QueryClient({defaultOptions: {queries: {retry: false}}});
  if (data) client.setQueryData(['supabase-settings'], data);
  try {return renderToStaticMarkup(React.createElement(ReactQuery.QueryClientProvider, {client}, React.createElement(SupabaseSettingsSection)));}
  finally {client.clear();}
}

test('actual user form enables masked fields and explains private profile scope', () => {
  const html = renderSettings({canManage: true, projectUrl: input.projectUrl, hasPublicKey: false, hasSecretKey: false, requiresRestart: true});
  for (const id of ['supabase-public-key', 'supabase-secret-key']) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
    assert.match(html, new RegExp(`<input(?=[^>]*id="${id}")(?=[^>]*type="password")[^>]*>`));
  }
  assert.ok(html.includes('Data tidak dipindahkan'));
  assert.ok(html.includes('Profil ini tidak menukar sambungan aplikasi'));
  assert.equal(html.includes(input.secretKey), false);
  assert.doesNotMatch(html, /<fieldset[^>]*disabled/);
  assert.equal(html.includes('Hanya admin'), false);
  assert.ok(html.includes('Paparkan secret key'));
});

test('actual form hides controls during loading', () => {
  assert.ok(renderSettings().includes('Memuatkan konfigurasi Supabase'));
  assert.equal(renderSettings().includes('id="supabase-secret-key"'), false);
});
