import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { envPath } from '../src/lib/env-file.server.ts';
import { getLlmEnvSettings, getSavedLlmConfig, saveLlmEnvSettings } from '../src/lib/llm-env.server.ts';
import { getSupabaseEnvSettings, saveSupabaseEnvSettings } from '../src/lib/supabase-env.server.ts';
import { getActiveLlmConfig } from '../src/lib/platform-key.server.ts';
import { createEmbedding } from '../src/lib/embeddings.server.ts';

const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const ai = { provider: 'deepseek', baseUrl: '', model: 'owner-model', apiKey: 'sk-owner-a-fixture' };
const database = { projectUrl: 'https://owner-a.supabase.co', publicKey: 'sb_publishable_owner_a', secretKey: 'sb_secret_owner_a' };

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lokalchat-tenant-env-'));
  const names = ['LOKALCHAT_USER_ENV_DIR', 'LOKALCHAT_ENV_FILE', 'SUPABASE_URL', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'OPENAI_API_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    LOKALCHAT_USER_ENV_DIR: join(dir, 'users'), LOKALCHAT_ENV_FILE: join(dir, 'operator.env'),
    SUPABASE_URL: 'https://login.supabase.co', AI_API_KEY: 'sk-global-must-not-be-used',
    AI_BASE_URL: 'https://api.openai.com/v1', AI_MODEL: 'global-model', OPENAI_API_KEY: 'sk-global-embedding',
  });
  await writeFile(process.env.LOKALCHAT_ENV_FILE, 'AI_API_KEY=sk-operator-fixture\nSUPABASE_URL=https://login.supabase.co\n');
  t.after(async () => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('two accounts read and rotate only their own AI and Supabase credentials', async t => {
  await fixture(t);
  const operatorBefore = await readFile(process.env.LOKALCHAT_ENV_FILE, 'utf8');
  await Promise.all([
    saveLlmEnvSettings(ownerA, ai),
    saveLlmEnvSettings(ownerB, { ...ai, apiKey: 'sk-owner-b-fixture', model: 'owner-b-model' }),
  ]);
  await Promise.all([
    saveSupabaseEnvSettings(ownerA, database),
    saveSupabaseEnvSettings(ownerB, { ...database, projectUrl: 'https://owner-b.supabase.co', publicKey: 'sb_publishable_owner_b', secretKey: 'sb_secret_owner_b' }),
  ]);
  const beforeB = await readFile(envPath(ownerB), 'utf8');
  await saveLlmEnvSettings(ownerA, { ...ai, apiKey: 'sk-owner-a-rotated' });
  await saveSupabaseEnvSettings(ownerA, { ...database, secretKey: 'sb_secret_owner_a_rotated' });
  assert.equal((await getActiveLlmConfig(ownerA)).apiKey, 'sk-owner-a-rotated');
  assert.equal((await getActiveLlmConfig(ownerB)).apiKey, 'sk-owner-b-fixture');
  assert.equal((await getSupabaseEnvSettings(ownerA)).projectUrl, database.projectUrl);
  assert.equal((await getSupabaseEnvSettings(ownerB)).projectUrl, 'https://owner-b.supabase.co');
  assert.equal(await readFile(envPath(ownerB), 'utf8'), beforeB);
  assert.equal(await readFile(process.env.LOKALCHAT_ENV_FILE, 'utf8'), operatorBefore);
  const status = JSON.stringify([await getLlmEnvSettings(ownerA), await getSupabaseEnvSettings(ownerA)]);
  assert.doesNotMatch(status, /sk-owner|sb_secret_|sb_publishable_/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(envPath(ownerA))).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(envPath(ownerA)))).mode & 0o777, 0o700);
  }
});

test('an unconfigured account cannot inherit global keys or another account’s retained keys', async t => {
  await fixture(t);
  await saveLlmEnvSettings(ownerA, ai);
  await saveSupabaseEnvSettings(ownerA, database);
  assert.equal((await getLlmEnvSettings(ownerB)).hasApiKey, false);
  assert.equal((await getLlmEnvSettings(ownerB)).model, '');
  assert.equal((await getSupabaseEnvSettings(ownerB)).projectUrl, '');
  assert.equal((await getSupabaseEnvSettings(ownerB)).hasSecretKey, false);
  assert.equal(await getSavedLlmConfig(ownerB), null);
  await assert.rejects(getActiveLlmConfig(ownerB), /akaun anda/);
  await assert.rejects(saveLlmEnvSettings(ownerB, { ...ai, apiKey: '' }), /Masukkan API key/);
  await assert.rejects(saveSupabaseEnvSettings(ownerB, { ...database, publicKey: '', secretKey: '' }), /kedua-dua/);
  assert.equal((await getActiveLlmConfig(ownerA)).apiKey, ai.apiKey);
});

test('tenant identity rejects missing IDs and traversal; identical UUIDs in other Auth projects stay isolated', async t => {
  await fixture(t);
  for (const value of [undefined, null, '', '../operator', '/tmp/another.env', 'a/b', '__proto__', { userId: ownerA }]) {
    assert.throws(() => envPath(value), /Identiti/);
  }
  await saveLlmEnvSettings(ownerA, ai);
  const original = envPath(ownerA);
  process.env.SUPABASE_URL = 'https://different-auth.supabase.co';
  assert.notEqual(envPath(ownerA), original);
  assert.equal(await getSavedLlmConfig(ownerA), null);
  await assert.rejects(getActiveLlmConfig(ownerA), /akaun anda/);
});

test('corrupt or inaccessible owner config fails closed instead of using global credentials', async t => {
  await fixture(t);
  await saveLlmEnvSettings(ownerA, ai);
  const path = envPath(ownerA);
  await writeFile(path, "AI_CONFIG_SOURCE=env\nAI_PROVIDER=deepseek\nAI_API_KEY=bad'key\nAI_MODEL=model\nAI_BASE_URL=https://api.deepseek.com\n");
  await assert.rejects(getActiveLlmConfig(ownerA), /tidak dapat dibaca/);
  await rm(path);
  await symlink(process.env.LOKALCHAT_ENV_FILE, path);
  await assert.rejects(getActiveLlmConfig(ownerA), /tidak dapat dibaca/);
});

test('symlinked tenant directories cannot redirect reads or writes into other accounts', async t => {
  await fixture(t);
  await saveLlmEnvSettings(ownerA, ai);
  const before = await readFile(envPath(ownerA), 'utf8');
  await symlink(dirname(envPath(ownerA)), dirname(envPath(ownerB)));
  await assert.rejects(getLlmEnvSettings(ownerB), /tidak dapat dibaca/);
  await assert.rejects(saveLlmEnvSettings(ownerB, { ...ai, apiKey: 'sk-attacker' }), /Gagal menyimpan/);
  assert.equal(await readFile(envPath(ownerA), 'utf8'), before);
});

test('embeddings never use the installation OPENAI_API_KEY for unconfigured accounts', async t => {
  await fixture(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(init.headers.Authorization);
    return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }));
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await saveLlmEnvSettings(ownerA, { ...ai, provider: 'openai', apiKey: 'sk-owner-embedding' });
  assert.equal(await createEmbedding('owner B text', ownerB), null);
  assert.deepEqual(await createEmbedding('owner A text', ownerA), [0.1, 0.2]);
  assert.deepEqual(requests, ['Bearer sk-owner-embedding']);
});
