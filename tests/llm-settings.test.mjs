import { usePreferences } from "../src/components/lokalchat/usePreferences.ts";
import { useSettingsDirty } from "../src/components/lokalchat/SettingsDirtyContext.tsx";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink, readdir } from 'node:fs/promises';
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
import * as llmSettings from '../src/lib/llm-settings.ts';
import { validateLlmSettings } from '../src/lib/llm-settings.ts';
import { getLlmEnvSettings, getSavedLlmConfig, saveLlmEnvSettings } from '../src/lib/llm-env.server.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const input = { provider: 'deepseek', baseUrl: '', model: 'test-chat-model', apiKey: 'sk-test-fixture-only' };
async function fixture(t, content = '') {
  const dir = await mkdtemp(join(tmpdir(), 'lokalchat-llm-'));
  const old = process.env.LOKALCHAT_USER_ENV_DIR;
  process.env.LOKALCHAT_USER_ENV_DIR = dir;
  const file = envPath(userId);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  t.after(async () => {
    if (old === undefined) delete process.env.LOKALCHAT_USER_ENV_DIR; else process.env.LOKALCHAT_USER_ENV_DIR = old;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, file };
}

test('validates providers and prevents env injection without echoing credentials', () => {
  for (const apiKey of ['secret\nVITE_LEAK=1', "secret'", 'secret key', 'REPLACE_ME']) {
    assert.throws(() => validateLlmSettings({ ...input, apiKey }), error => !error.message.includes(apiKey));
  }
  for (const data of [null, {}, { ...input, provider: '__proto__' }, { ...input, apiKey: 5 }, { ...input, model: 'bad\nMODEL=1' },
    ...['http://api.example.com', 'https://user:password@api.example.com', 'https://api.example.com?q=secret', 'https://api.example.com/#secret'].map(baseUrl => ({ ...input, provider: 'custom', baseUrl }))]) {
    assert.throws(() => validateLlmSettings(data));
  }
  assert.equal(validateLlmSettings(input).baseUrl, 'https://api.deepseek.com');
});

test('saves only LLM fields, preserves unrelated multiline settings and removes duplicate assignments', async t => {
  const original = '# keep this comment\r\nSUPABASE_URL=https://project.example\r\nOTHER_SECRET="line one\nAI_API_KEY=inside-another-value\nline three"\r\nAI_API_KEY="old\nmultiline-key"\r\nexport AI_API_KEY=duplicate\r\nAI_MODEL=old-model # comment\r\n';
  const { dir, file } = await fixture(t, original);
  const result = await saveLlmEnvSettings(userId, input);
  const saved = await readFile(file, 'utf8');
  const parsed = parseEnv(saved);
  assert.equal(parsed.SUPABASE_URL, 'https://project.example');
  assert.equal(parsed.OTHER_SECRET, parseEnv(original).OTHER_SECRET);
  assert.ok(saved.startsWith('# keep this comment\r\n'));
  assert.equal(parsed.AI_API_KEY, input.apiKey);
  assert.equal(parsed.AI_CONFIG_SOURCE, 'env');
  assert.equal(parsed.AI_PROVIDER, 'deepseek');
  assert.equal(parsed.AI_MODEL, input.model);
  assert.equal(saved.includes('duplicate'), false);
  assert.equal(saved.includes('multiline-key'), false);
  assert.equal(result.hasApiKey, true);
  assert.equal(result.active, true);
  assert.equal(JSON.stringify(result).includes(input.apiKey), false);
  assert.equal(JSON.stringify(await getLlmEnvSettings(userId)).includes(input.apiKey), false);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dirname(file)), ['.env']);
});

test('blank key retains same endpoint key; switching provider requires a new key', async t => {
  const { file } = await fixture(t);
  await saveLlmEnvSettings(userId, input);
  await saveLlmEnvSettings(userId, { ...input, model: 'another-model', apiKey: '' });
  assert.equal(parseEnv(await readFile(file, 'utf8')).AI_API_KEY, input.apiKey);
  const before = await readFile(file, 'utf8');
  await assert.rejects(saveLlmEnvSettings(userId, { ...input, provider: 'openai', apiKey: '' }), /Masukkan API key/);
  await assert.rejects(saveLlmEnvSettings(userId, { ...input, provider: 'custom', baseUrl: 'https://other.example/v1', apiKey: '' }), /Masukkan API key/);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('persisted config is read fresh across requests and wins over stale process env', async t => {
  const { file } = await fixture(t);
  const old = process.env.AI_API_KEY;
  process.env.AI_API_KEY = 'stale-process-fixture';
  t.after(() => { if (old === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = old; });
  assert.equal(await getSavedLlmConfig(userId), null);
  await saveLlmEnvSettings(userId, input);
  assert.equal((await getSavedLlmConfig(userId)).apiKey, input.apiKey);
  await saveLlmEnvSettings(userId, { ...input, apiKey: 'sk-second-fixture' });
  assert.equal((await getSavedLlmConfig(userId)).apiKey, 'sk-second-fixture');
  assert.equal(parseEnv(await readFile(file, 'utf8')).AI_API_KEY, 'sk-second-fixture');
});

test('never writes the operator-selected installation env', async t => {
  const { dir } = await fixture(t);
  const operatorFile = join(dir, 'operator.env');
  await writeFile(operatorFile, 'AI_API_KEY=operator-only\n');
  const previous = process.env.LOKALCHAT_ENV_FILE;
  process.env.LOKALCHAT_ENV_FILE = operatorFile;
  t.after(() => { if (previous === undefined) delete process.env.LOKALCHAT_ENV_FILE; else process.env.LOKALCHAT_ENV_FILE = previous; });
  await saveLlmEnvSettings(userId, input);
  assert.equal(await readFile(operatorFile, 'utf8'), 'AI_API_KEY=operator-only\n');
});

test('refuses symlinks and unfinished quotes without changing the original', async t => {
  const { dir, file } = await fixture(t, 'UNRELATED="unfinished\n');
  const before = await readFile(file, 'utf8');
  await assert.rejects(saveLlmEnvSettings(userId, input), /Gagal menyimpan/);
  assert.equal(await readFile(file, 'utf8'), before);
  const alias = join(dir, 'linked');
  await symlink(dir, alias);
  process.env.LOKALCHAT_USER_ENV_DIR = alias;
  await assert.rejects(saveLlmEnvSettings(userId, input), /Gagal menyimpan/);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('exclusive lock blocks simultaneous writers and never removes someone else’s lock', async t => {
  const { file } = await fixture(t, 'UNRELATED=keep\n');
  await writeFile(`${file}.settings.lock`, 'another writer');
  await assert.rejects(saveLlmEnvSettings(userId, input), /sedang disimpan/);
  assert.equal(await readFile(`${file}.settings.lock`, 'utf8'), 'another writer');
  assert.equal(await readFile(file, 'utf8'), 'UNRELATED=keep\n');
});

function loadModule(relative, dependencies, globals = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, process, console, URL, ...globals });
  return module.exports;
}

test('agent uses only the selected owner configuration', async () => {
  const config = { apiKey: 'sk-saved-fixture', baseUrl: 'https://api.deepseek.com', model: 'saved-model' };
  const platform = loadModule('../src/lib/platform-key.server.ts', {
    '@/integrations/supabase/client.server': { supabaseAdmin: { from() { assert.fail('DB must not override saved configuration'); } } },
    './wa-crypto.server': {}, './llm-env.server': { getSavedLlmConfig: async owner => { assert.equal(owner, userId); return config; } },
  });
  assert.equal(await platform.getActiveLlmConfig(userId), config);
});

function handlers(role, options = {}) {
  let reads = 0, writes = 0;
  const context = { userId: 'verified-account', supabase: { from() { if (options.forbidProfileRead) assert.fail('LLM settings must not query admin roles'); return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: role ? { role } : null, error: options.dbError ? { message: 'db-fixture' } : null }; } }; } } };
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
    './llm-settings': { validateLlmSettings },
    './ssrf.server': { assertPublicHttpUrl: async () => { if (options.blocked) throw new Error('private endpoint'); } },
    './llm-env.server': {
      getLlmEnvSettings: async owner => { assert.equal(owner, context.userId); reads++; return { hasApiKey: true }; },
      saveLlmEnvSettings: async owner => { assert.equal(owner, context.userId); writes++; return { hasApiKey: true }; },
    },
  });
  return { api, get reads() { return reads; }, get writes() { return writes; } };
}

test('signed-in users can read and save LLM settings without an admin role or profile lookup', async () => {
  for (const role of ['sme', null, 'admin']) {
    const h = handlers(role, { dbError: true, forbidProfileRead: true });
    assert.equal((await h.api.getLlmSettings()).canManage, true);
    assert.equal((await h.api.saveLlmSettings({ data: input })).canManage, true);
    assert.equal(h.reads, 1); assert.equal(h.writes, 1);
  }
});

test('missing login and invalid tokens cannot read or write LLM settings', async () => {
  for (const options of [{ noLogin: true }, { invalidToken: true }]) {
    const h = handlers('sme', options);
    await assert.rejects(h.api.getLlmSettings(), /Unauthorized/);
    await assert.rejects(h.api.saveLlmSettings({ data: input }), /Unauthorized/);
    assert.equal(h.reads, 0);
    assert.equal(h.writes, 0);
  }
});

test('ordinary user can save; malformed and private custom endpoint requests never reach storage', async () => {
  const h = handlers('sme');
  assert.equal((await h.api.getLlmSettings()).canManage, true);
  await h.api.saveLlmSettings({ data: { ...input, userId: 'forged-other-account' } });
  assert.equal(h.writes, 1);
  await assert.rejects(h.api.saveLlmSettings({ data: { ...input, apiKey: 'bad\nINJECT=1' } }));
  assert.equal(h.writes, 1);
  const blocked = handlers('sme', { blocked: true });
  await assert.rejects(blocked.api.saveLlmSettings({ data: { ...input, provider: 'custom', baseUrl: 'https://127.0.0.1/v1' } }), /HTTPS awam/);
  assert.equal(blocked.writes, 0);
});

const { LlmSettingsSection } = loadModule('../src/components/lokalchat/LlmSettingsSection.tsx', {
  'react': React, 'react/jsx-runtime': jsxRuntime, '@tanstack/react-query': ReactQuery,
  '@/services/api': { useApi: fn => fn, getLlmSettings: async () => ({}), saveLlmSettings: async () => ({}) },
  '@/lib/llm-settings': llmSettings,
  '@/components/lokalchat/usePreferences': {usePreferences}, './SettingsDirtyContext': {useSettingsDirty},
  '@/components/ui/input': { Input }, '@/components/ui/label': { Label }, '@/components/ui/button': { Button },
});

function renderSettings(data) {
  const client = new ReactQuery.QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (data) client.setQueryData(['llm-settings'], data);
  try { return renderToStaticMarkup(React.createElement(ReactQuery.QueryClientProvider, { client }, React.createElement(LlmSettingsSection))); }
  finally { client.clear(); }
}

test('real Settings section renders enabled masked inputs and providers for signed-in users', () => {
  const html = renderSettings({ canManage: true, provider: 'gemini', baseUrl: '', model: '', hasApiKey: false, active: false });
  assert.match(html, /<label[^>]*for="llm-key"/);
  assert.match(html, /<input(?=[^>]*id="llm-key")(?=[^>]*type="password")[^>]*>/);
  for (const name of ['Google Gemini', 'DeepSeek', 'OpenAI', 'Provider lain']) assert.ok(html.includes(name));
  assert.ok(html.includes('Simpan konfigurasi AI'));
  assert.ok(html.includes('ID model'));
  assert.doesNotMatch(html, /<fieldset[^>]*disabled/);
  assert.equal(html.includes('Hubungi admin'), false);
});

test('real Settings section hides controls during loading', () => {
  const loading = renderSettings();
  assert.ok(loading.includes('Memuatkan konfigurasi AI'));
  assert.equal(loading.includes('id="llm-key"'), false);
});
