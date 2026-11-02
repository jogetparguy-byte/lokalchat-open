import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject, parseArgs } from '../bin/create-lokalchat.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'create-lokalchat-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const template = join(root, 'template');
  await mkdir(template);
  await writeFile(join(template, 'package.json'), JSON.stringify({ name: 'template', private: true }));
  await writeFile(join(template, 'gitignore'), '.env\nnode_modules\n');
  await writeFile(join(template, '.env.example'), 'SUPABASE_SERVICE_ROLE_KEY=REPLACE_ME\n');
  return { cwd: root, template, log: () => {} };
}

test('arguments reject unknown options, extra directories and arbitrary executable names', () => {
  assert.deepEqual(parseArgs(['my-app', '--skip-install', '--package-manager=pnpm']), { directory: 'my-app', packageManager: 'pnpm', install: false });
  for (const args of [['--force'], ['a', 'b'], ['--package-manager', 'sh'], ['--package-manager']]) assert.throws(() => parseArgs(args));
});

test('npm bin symlink executes the CLI entrypoint', async t => {
  const deps = await fixture(t);
  const executable = join(deps.cwd, 'create-lokalchat');
  await symlink(fileURLToPath(new URL('../bin/create-lokalchat.mjs', import.meta.url)), executable);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [executable, '--help'], { encoding: 'utf8', env });
  if (result.error?.code === 'EPERM') { t.skip('Sandbox blocks subprocess execution; run packed CLI smoke test outside sandbox.'); return; }
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: create-lokalchat/);
});

test('creates scaffold and placeholder env without executing commands when skipped', async t => {
  const deps = await fixture(t);
  deps.run = () => { throw new Error('must not execute'); };
  const destination = await createProject({ directory: 'My App', packageManager: 'npm', install: false }, deps);
  assert.equal(JSON.parse(await readFile(join(destination, 'package.json'))).name, 'my-app');
  assert.equal(await readFile(join(destination, '.env'), 'utf8'), 'SUPABASE_SERVICE_ROLE_KEY=REPLACE_ME\n');
  if (process.platform !== 'win32') assert.equal((await stat(join(destination, '.env'))).mode & 0o777, 0o600);
  assert.ok((await readdir(destination)).includes('.gitignore'));
  assert.ok(!(await readdir(destination)).includes('gitignore'));
});

test('refuses nonempty destinations without overwriting', async t => {
  const deps = await fixture(t);
  await mkdir(join(deps.cwd, 'app'));
  await writeFile(join(deps.cwd, 'app', 'precious'), 'keep');
  await assert.rejects(createProject({ directory: 'app', packageManager: 'npm', install: false }, deps), /empty/);
  assert.equal(await readFile(join(deps.cwd, 'app', 'precious'), 'utf8'), 'keep');
});

test('refuses symlink destination and ancestor', async t => {
  const deps = await fixture(t);
  await mkdir(join(deps.cwd, 'real'));
  await symlink(join(deps.cwd, 'real'), join(deps.cwd, 'alias'));
  for (const directory of ['alias', 'alias/app']) await assert.rejects(createProject({ directory, packageManager: 'npm', install: false }, deps), /symbolic/);
});

test('refuses symlink template files before creating the destination', async t => {
  const deps = await fixture(t);
  await writeFile(join(deps.cwd, 'credential'), 'do-not-copy');
  await symlink(join(deps.cwd, 'credential'), join(deps.template, 'leak'));
  await assert.rejects(createProject({ directory: 'app', packageManager: 'npm', install: false }, deps), /Template cannot contain symbolic links/);
  await assert.rejects(stat(join(deps.cwd, 'app')), { code: 'ENOENT' });
});

test('normalizes reserved and overlong npm package names', async t => {
  const deps = await fixture(t);
  for (const directory of ['node_modules', 'a'.repeat(220)]) {
    const destination = await createProject({ directory, packageManager: 'npm', install: false }, deps);
    const { name } = JSON.parse(await readFile(join(destination, 'package.json')));
    assert.ok(name.length <= 214);
    assert.notEqual(name, 'node_modules');
  }
});

for (const packageManager of ['npm', 'pnpm']) test(`${packageManager} installs build dependencies without a shell`, async t => {
  const deps = await fixture(t);
  let invocation;
  deps.run = (...args) => { invocation = args; return { status: 0 }; };
  const destination = await createProject({ directory: 'app', packageManager, install: true }, deps);
  assert.equal(invocation[0], packageManager);
  assert.deepEqual(invocation[1], packageManager === 'npm' ? ['install', '--include=dev'] : ['install', '--frozen-lockfile', '--prod=false']);
  assert.equal(invocation[2].cwd, destination);
  assert.equal(invocation[2].shell, false);
  assert.equal(invocation[2].env.NODE_ENV, 'development');
});

test('failed install returns actionable error and preserves scaffold for retry', async t => {
  const deps = await fixture(t);
  deps.run = () => ({ status: 1 });
  await assert.rejects(createProject({ directory: 'app', packageManager: 'npm', install: true }, deps), /dependency installation failed.*npm install --include=dev/);
  assert.ok((await readdir(join(deps.cwd, 'app'))).includes('package.json'));
});
