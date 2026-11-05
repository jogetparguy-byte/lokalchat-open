import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject, parseArgs, installCommand } from '../bin/create-lokalchat.mjs';
import { completions } from '../bin/completions.mjs';

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

test('renames npm lockfile metadata while preserving locked dependencies', async t => {
  const deps = await fixture(t);
  const locked = { name: 'template', lockfileVersion: 3, packages: { '': { name: 'template' }, 'node_modules/example': { version: '1.2.3', integrity: 'keep' } } };
  await writeFile(join(deps.template, 'package-lock.json'), JSON.stringify(locked));
  const destination = await createProject({ directory: 'My App', packageManager: 'npm', install: false }, deps);
  const lock = JSON.parse(await readFile(join(destination, 'package-lock.json')));
  assert.equal(lock.name, 'my-app');
  assert.equal(lock.packages[''].name, 'my-app');
  assert.deepEqual(lock.packages['node_modules/example'], locked.packages['node_modules/example']);
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
  const expected = installCommand(packageManager, packageManager === 'npm' ? ['install', '--include=dev'] : ['install', '--frozen-lockfile', '--prod=false']);
  assert.equal(invocation[0], expected[0]);
  assert.deepEqual(invocation[1], expected[1]);
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


test('Windows uses fixed cmd arguments; npm launched by npm uses its JS entrypoint', () => {
  assert.deepEqual(installCommand('npm', ['install', '--include=dev'], { platform: 'win32', env: {} }),
    ['cmd.exe', ['/d', '/s', '/c', 'npm.cmd install --include=dev']]);
  assert.deepEqual(installCommand('pnpm', ['install', '--frozen-lockfile', '--prod=false'], { platform: 'win32', env: {} }),
    ['cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd install --frozen-lockfile --prod=false']]);
  assert.deepEqual(installCommand('npm', ['install'], { env: { npm_execpath: '/npm/bin/npm-cli.js' }, execPath: '/node' }),
    ['/node', ['/npm/bin/npm-cli.js', 'install']]);
});

test('cancelled installation keeps files and provides a resume command', async t => {
  const deps = await fixture(t);
  deps.run = async () => ({ status: null, interrupted: true });
  await assert.rejects(createProject({ directory: 'app', packageManager: 'npm', install: true }, deps),
    error => error.exitCode === 130 && /Installation cancelled.*npm install/.test(error.message));
  assert.ok((await readdir(join(deps.cwd, 'app'))).includes('package.json'));
});

test('missing package manager preserves project and gives an actionable error', async t => {
  const deps = await fixture(t);
  deps.run = async () => { throw new Error('ENOENT'); };
  await assert.rejects(createProject({ directory: 'app', packageManager: 'pnpm', install: true }, deps), /dependency installation failed.*pnpm install/);
});

test('local setup is explicit and incompatible with skipping dependencies', () => {
  assert.equal(parseArgs(['app', '--setup-local']).setupLocal, true);
  assert.throws(() => parseArgs(['--setup-local', '--skip-install']), /requires dependency installation/);
});

test('completion output covers supported shells without creating a project', () => {
  for (const shell of ['bash', 'zsh', 'fish']) {
    assert.deepEqual(parseArgs(['--completions', shell]), { completions: shell });
    assert.match(completions(shell), /setup-local/);
  }
  assert.throws(() => parseArgs(['--completions']), /bash, zsh or fish/);
});

test('automatic local setup runs only after a successful dependency installation', async t => {
  const deps = await fixture(t);
  const calls = [];
  deps.run = async (...args) => { calls.push(args); return { status: 0 }; };
  const destination = await createProject({ directory: 'app', packageManager: 'npm', install: true, setupLocal: true }, deps);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], process.execPath);
  assert.deepEqual(calls[1][1], ['scripts/setup-local.mjs']);
  assert.equal(calls[1][2].cwd, destination);
  assert.equal(calls[1][2].shell, false);
});

test('cancelled local setup preserves project and gives its dedicated resume command', async t => {
  const deps = await fixture(t);
  let count = 0;
  deps.run = async () => ++count === 1 ? { status: 0 } : { status: null, interrupted: true };
  await assert.rejects(createProject({ directory: 'app', packageManager: 'npm', install: true, setupLocal: true }, deps),
    error => error.exitCode === 130 && /npm run setup:local/.test(error.message));
  assert.ok((await readdir(join(deps.cwd, 'app'))).includes('package.json'));
});
