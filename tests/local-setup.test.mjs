import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { parseEnv } from 'node:util';
import { setupLocal } from '../scripts/setup-local.mjs';
import { CLI_VERSION, applicationEnv, localConnections, localProcessEnv, parseLocalArgs } from '../scripts/local/config.mjs';
import { assertFreshEnv, lockSetup, prepareProject } from '../scripts/local/files.mjs';
import { cliArtifact, ensureCli, extractBinary } from '../scripts/local/download.mjs';
import { createRunner } from '../scripts/local/process.mjs';

const status = 'API_URL="http://127.0.0.1:23456"\nDB_URL="postgresql://postgres:local@127.0.0.1:23457/postgres"\nPUBLISHABLE_KEY="sb_publishable_test"\nSECRET_KEY="sb_secret_private_test"\n';

async function fixture(t) {
  const app = await mkdtemp(join(tmpdir(), 'lokalchat-local-test-'));
  t.after(() => rm(app, { recursive: true, force: true }));
  await mkdir(join(app, 'node_modules/vite/bin'), { recursive: true });
  await writeFile(join(app, 'node_modules/vite/bin/vite.js'), '');
  await writeFile(join(app, '.env.example'), 'SUPABASE_URL=REPLACE_ME\n');
  await writeFile(join(app, '.env'), 'SUPABASE_URL=REPLACE_ME\n');
  await mkdir(join(app, 'supabase/migrations'), { recursive: true });
  await writeFile(join(app, 'supabase/migrations/20260101000000_initial.sql'), '-- fixture\n');
  const commands = [], messages = [];
  const deps = {
    app, sourceEnv: { PATH: '/bin', HOME: '/test-home', SUPABASE_ACCESS_TOKEN: 'hosted-token', SUPABASE_DB_URL: 'hosted-url', AI_API_KEY: 'real-provider', NODE_OPTIONS: '--import=unsafe', LOKALCHAT_ENV_FILE: '/private/hosted.env' },
    output: message => messages.push(message), errorOutput: message => messages.push(message),
    portCheck: async () => {}, diskCheck: async () => ({ bavail: 3_000_000_000, bsize: 1 }),
    installCli: async directory => join(directory, 'supabase'),
    runnerFactory: settings => async (command, args, options = {}) => {
      commands.push({ command, args, options, settings });
      if (args[0] === '--version') return CLI_VERSION + '\n';
      if (args[0] === 'status') return status;
      return '';
    },
    verify: async (connection, expected) => { assert.equal(connection.apiUrl, 'http://127.0.0.1:23456'); assert.deepEqual(expected, ['20260101000000']); },
    health: async () => {},
  };
  return { app, commands, messages, deps };
}

test('local arguments support unattended use and reject invalid combinations', () => {
  assert.deepEqual(parseLocalArgs(['--runtime=native', '--check']), { runtime: 'native', check: true, stop: false });
  for (const args of [['--runtime'], ['--runtime', 'sh'], ['--remote'], ['--check', '--stop']]) assert.throws(() => parseLocalArgs(args));
  assert.deepEqual(parseLocalArgs(['--help']), { help: true });
});

test('rejects remote endpoints, redirect URLs and privileged public keys, including legacy JWTs', () => {
  assert.equal(localConnections(status).publicKey, 'sb_publishable_test');
  const roleKey = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  for (const bad of [
    status.replace('http://127.0.0.1:23456', 'https://project.supabase.co'),
    status.replace('127.0.0.1:23457', 'example.com:5432'),
    status.replace('http://127.0.0.1:23456', 'http://127.0.0.1:23456/?redirect=remote'),
    status.replace('sb_publishable_test', 'sb_secret_leak'),
    status.replace('sb_publishable_test', roleKey),
    status.replace('SECRET_KEY="sb_secret_private_test"', ''),
  ]) assert.throws(() => localConnections(bad));
  assert.equal(localConnections(status.replace('PUBLISHABLE_KEY', 'ANON_KEY').replace('SECRET_KEY', 'SERVICE_ROLE_KEY')).secretKey, 'sb_secret_private_test');
});

test('keeps system settings and drops hosted targets, provider keys and preloads', () => {
  const env = localProcessEnv({ PATH: '/bin', HOME: '/home/user', SystemRoot: 'C:\\Windows', SUPABASE_ACCESS_TOKEN: 'secret', SUPABASE_DB_URL: 'remote', AI_API_KEY: 'secret', NODE_OPTIONS: 'unsafe', LOKALCHAT_ENV_FILE: 'remote.env' }, '/state');
  assert.equal(env.HOME, '/home/user');
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.SUPABASE_HOME, '/state');
  for (const name of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_URL', 'AI_API_KEY', 'NODE_OPTIONS', 'LOKALCHAT_ENV_FILE']) assert.ok(!(name in env));
});

test('serializes local secrets only into server variables', () => {
  const env = parseEnv(applicationEnv(localConnections(status), 'a'.repeat(64)));
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, 'sb_secret_private_test');
  for (const [name, value] of Object.entries(env)) if (name.startsWith('VITE_')) assert.ok(!value.includes('sb_secret_'));
});

test('local launcher preserves LLM settings when refreshing database credentials', async t => {
  const { app, deps } = await fixture(t);
  await setupLocal(parseLocalArgs(['--runtime=native', '--check']), deps);
  const path = join(app, '.lokalchat/local.env');
  const settings = { AI_PROVIDER: 'deepseek', AI_API_KEY: 'sk-test-local-fixture', AI_MODEL: 'test-model', AI_BASE_URL: 'https://api.deepseek.com', AI_CONFIG_SOURCE: 'env' };
  await writeFile(path, (await readFile(path, 'utf8')) + Object.entries(settings).map(([key, value]) => `${key}='${value}'\n`).join(''));
  await setupLocal(parseLocalArgs(['--runtime=native', '--check']), deps);
  const next = parseEnv(await readFile(path, 'utf8'));
  for (const [key, value] of Object.entries(settings)) assert.equal(next[key], value);
  assert.equal(next.SUPABASE_SERVICE_ROLE_KEY, 'sb_secret_private_test');
});

test('Settings Supabase survives launcher restart without starting or migrating any database', async t => {
  const { app, deps, commands, messages } = await fixture(t);
  await setupLocal(parseLocalArgs(['--check']), deps);
  const path = join(app, '.lokalchat/local.env');
  const saved = 'SUPABASE_CONFIG_SOURCE=settings\nSUPABASE_URL=https://selected.supabase.co\nVITE_SUPABASE_URL=https://selected.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_selected\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_selected\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_selected\nAI_API_KEY=sk-retained\nWHATSAPP_CRYPTO_KEY=' + 'a'.repeat(64) + '\n';
  await writeFile(path, saved);
  commands.length = 0;
  deps.installCli = async () => { assert.fail('must not download CLI for selected project'); };
  deps.verify = deps.health = async () => { assert.fail('must not touch selected database'); };
  await setupLocal(parseLocalArgs([]), deps);
  assert.deepEqual(commands.map(call => call.args[0]), ['scripts/check-env.mjs', 'scripts/dev.mjs']);
  assert.equal(commands[1].options.env.LOKALCHAT_ENV_FILE, path);
  assert.equal(await readFile(path, 'utf8'), saved);
  assert.ok(messages.some(message => message.includes('No local database is started or migrated')));
  commands.length = 0;
  await setupLocal(parseLocalArgs(['--check']), deps);
  assert.deepEqual(commands.map(call => call.args[0]), ['scripts/check-env.mjs']);
  assert.equal(await readFile(path, 'utf8'), saved);
});

test('check mode verifies local setup, preserves .env, hides keys, and stops without starting the app', async t => {
  const { app, deps, commands, messages } = await fixture(t);
  await setupLocal(parseLocalArgs(['--runtime=native', '--check']), deps);
  assert.equal(await readFile(join(app, '.env'), 'utf8'), 'SUPABASE_URL=REPLACE_ME\n');
  const local = parseEnv(await readFile(join(app, '.lokalchat/local.env'), 'utf8'));
  assert.equal(local.SUPABASE_SERVICE_ROLE_KEY, 'sb_secret_private_test');
  assert.match(local.WHATSAPP_CRYPTO_KEY, /^[a-f0-9]{64}$/);
  if (process.platform !== 'win32') assert.equal((await stat(join(app, '.lokalchat/local.env'))).mode & 0o777, 0o600);
  assert.deepEqual(commands.map(call => call.args[0]), ['--version', 'start', 'migration', 'status', 'scripts/check-env.mjs', 'stop']);
  assert.ok(commands.find(call => call.args[0] === 'start').args.includes('native'));
  assert.deepEqual(commands.find(call => call.args[0] === 'migration').args, ['migration', 'up', '--yes']);
  const appCheck = commands.find(call => call.args[0] === 'scripts/check-env.mjs');
  assert.equal(appCheck.options.env.LOKALCHAT_ENV_FILE, join(app, '.lokalchat/local.env'));
  for (const call of commands) {
    assert.equal(call.settings.cwd, join(app, '.lokalchat/project'));
    assert.equal(call.settings.env.SUPABASE_HOME, join(app, '.lokalchat/supabase'));
    assert.ok(!call.settings.env.SUPABASE_ACCESS_TOKEN);
    assert.ok(!call.args.some(arg => /--remote|--linked|--db-url|reset|destroy|--all/.test(arg)));
  }
  assert.ok(!messages.join('\n').includes('sb_secret_private_test'));
  assert.ok(!(await readdir(join(app, '.lokalchat'))).includes('setup.lock'));
  await setupLocal(parseLocalArgs(['--check']), deps);
  assert.equal(parseEnv(await readFile(join(app, '.lokalchat/local.env'), 'utf8')).WHATSAPP_CRYPTO_KEY, local.WHATSAPP_CRYPTO_KEY);
});

test('launches app with the private local env and stops only its database after exit', async t => {
  const { app, deps, commands } = await fixture(t);
  await setupLocal(parseLocalArgs([]), deps);
  const call = commands.find(call => call.args[0] === 'scripts/dev.mjs');
  assert.equal(call.options.timeout, 0);
  assert.equal(call.options.cwd, app);
  assert.equal(call.options.env.LOKALCHAT_ENV_FILE, join(app, '.lokalchat/local.env'));
  assert.equal(call.options.visible, true);
  assert.deepEqual(commands.at(-1).args, ['stop']);
});

for (const failurePoint of ['start', 'migration', 'status', 'health', 'abort', 'stop']) test(`failure at ${failurePoint} preserves data, releases lock, and does not retry`, async t => {
  const { app, deps, commands, messages } = await fixture(t);
  const factory = deps.runnerFactory;
  deps.runnerFactory = settings => {
    const run = factory(settings);
    return async (command, args, options) => {
      const result = await run(command, args, options);
      if (args[0] === failurePoint) throw new Error('secret-from-child-sb_secret_should_not_print');
      return result;
    };
  };
  if (failurePoint === 'health') deps.health = async () => { throw new Error('secret-from-child-sb_secret_should_not_print'); };
  if (failurePoint === 'abort') {
    const controller = new AbortController(); deps.signal = controller.signal;
    deps.health = async () => { controller.abort(); controller.signal.throwIfAborted(); };
  }
  await assert.rejects(setupLocal(parseLocalArgs(['--check']), deps));
  assert.equal(commands.filter(call => call.args[0] === 'start').length, 1);
  assert.equal(commands.filter(call => call.args[0] === 'stop').length, 1);
  assert.equal(commands.at(-1).options.cleanup, true);
  assert.equal(await readFile(join(app, '.env'), 'utf8'), 'SUPABASE_URL=REPLACE_ME\n');
  assert.ok(!(await readdir(join(app, '.lokalchat'))).includes('setup.lock'));
  assert.ok(!messages.join('\n').includes('secret-from-child'));
});

test('refuses configured environment files before downloading or touching a database', async t => {
  const { app, deps, commands } = await fixture(t);
  await writeFile(join(app, '.env'), 'SUPABASE_URL=https://customer.supabase.co\n');
  deps.installCli = async () => { assert.fail('must not download'); };
  await assert.rejects(setupLocal(parseLocalArgs(['--check']), deps), /custom environment/);
  assert.equal(commands.length, 0);
  assert.equal(await readFile(join(app, '.env'), 'utf8'), 'SUPABASE_URL=https://customer.supabase.co\n');
  await writeFile(join(app, '.env'), 'SUPABASE_URL=REPLACE_ME\n');
  await writeFile(join(app, '.env.local'), 'VITE_SUPABASE_URL=https://customer.supabase.co\n');
  await assert.rejects(assertFreshEnv(app), /custom environment/);
});

test('refuses symlinks and concurrent setup without writing through them', async t => {
  const { app, deps } = await fixture(t);
  const elsewhere = join(app, 'elsewhere'); await mkdir(elsewhere);
  await symlink(elsewhere, join(app, '.lokalchat'));
  await assert.rejects(setupLocal(parseLocalArgs(['--check']), deps), /symbolic links/);
  assert.deepEqual(await readdir(elsewhere), []);
  await rm(join(app, '.lokalchat'));
  await mkdir(join(app, '.lokalchat'));
  const release = await lockSetup(join(app, '.lokalchat'));
  await assert.rejects(setupLocal(parseLocalArgs(['--check']), deps), /Another local setup/);
  await release();
});

test('preserves copied migration history and rejects edited or missing migrations', async t => {
  const { app } = await fixture(t);
  const workdir = join(app, '.lokalchat/project');
  await prepareProject(app, workdir);
  await writeFile(join(app, 'supabase/migrations/20260101000000_initial.sql'), '-- changed\n');
  await assert.rejects(prepareProject(app, workdir), /changed after/);
  assert.equal(await readFile(join(workdir, 'supabase/migrations/20260101000000_initial.sql'), 'utf8'), '-- fixture\n');
});

test('stop-only works even when app environment has been configured, without starting services', async t => {
  const { app, deps, commands } = await fixture(t);
  await setupLocal(parseLocalArgs(['--check']), deps);
  await writeFile(join(app, '.env'), 'SUPABASE_URL=https://hosted.example\n');
  commands.length = 0;
  await setupLocal(parseLocalArgs(['--stop']), deps);
  assert.deepEqual(commands.map(call => call.args[0]), ['--version', 'stop']);
});

test('unknown platform fails before downloading; supported artifacts stay pinned', () => {
  assert.throws(() => cliArtifact('freebsd', 'x64'), /manual setup/);
  assert.equal(cliArtifact('win32', 'arm64').binary, 'supabase.exe');
  assert.equal(cliArtifact('linux', 'x64').filename, 'supabase_3.0.0_linux_amd64.tar.gz');
  assert.equal(cliArtifact('linux', 'x64').sha256.length, 64);
});

function archive(name = 'supabase', type = 48, body = Buffer.from('fake executable')) {
  const header = Buffer.alloc(512);
  header.write(name); header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header.fill(32, 148, 156); header[156] = type;
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512 + 1024)]));
}

test('archive extraction accepts only the expected regular binary; rejects traversal, links and truncation', async t => {
  const { app } = await fixture(t);
  const path = join(app, 'cli.tar.gz');
  await writeFile(path, archive());
  await extractBinary(path, join(app, 'good'), 'supabase');
  assert.equal(await readFile(join(app, 'good'), 'utf8'), 'fake executable');
  for (const [index, data] of [archive('../supabase'), archive('supabase', 50), gzipSync(Buffer.alloc(20))].entries()) {
    await writeFile(path, data);
    await assert.rejects(extractBinary(path, join(app, `bad-${index}`), 'supabase'));
  }
});

test('bootstrap rejects download checksum mismatch and removes partial files', async t => {
  const { app } = await fixture(t);
  const directory = join(app, 'cli');
  await assert.rejects(ensureCli(directory, { platform: 'linux', arch: 'x64', fetchUrl: async () => new Response(archive()) }), /checksum mismatch/);
  assert.deepEqual(await readdir(directory), []);
});

test('bootstrap verifies cached binary before use and makes no network call', async t => {
  const { app } = await fixture(t);
  const directory = join(app, 'cli'); await mkdir(directory);
  const data = Buffer.from('cached binary');
  await writeFile(join(directory, 'supabase'), data);
  await writeFile(join(directory, 'verified.json'), JSON.stringify({ archive: cliArtifact('linux', 'x64').sha256, binary: createHash('sha256').update(data).digest('hex') }));
  const options = { platform: 'linux', arch: 'x64', fetchUrl: () => { assert.fail('cache must be offline'); } };
  assert.equal(await ensureCli(directory, options), join(directory, 'supabase'));
  await writeFile(join(directory, 'supabase'), 'tampered');
  await assert.rejects(ensureCli(directory, options), /verification failed/);
});

test('runner keeps child output private and passes arguments without a shell', async () => {
  let invocation, log = '';
  const run = createRunner({ cwd: '/local', env: { PATH: '/bin' }, log: { write: value => { log += value; } }, spawnChild: (...args) => {
    invocation = args;
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    queueMicrotask(() => { child.stdout.write('secret-output'); child.stderr.write('private-error'); child.emit('close', 0); });
    return child;
  } });
  assert.equal(await run('cli', ['status', '--env'], { capture: true }), 'secret-output');
  assert.equal(invocation[2].shell, false);
  assert.equal(log, 'secret-outputprivate-error');
});

test('runner cancellation terminates once, allows cleanup and removes listeners', async () => {
  const controller = new AbortController();
  let kills = 0;
  const run = createRunner({ cwd: '/local', env: {}, signal: controller.signal, log: { write() {} }, spawnChild: () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { kills++; queueMicrotask(() => child.emit('close', null)); };
    queueMicrotask(() => controller.abort()); return child;
  } });
  await assert.rejects(run('cli', ['start']));
  assert.equal(kills, 1);
});
