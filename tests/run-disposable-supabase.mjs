/** Provision a new local stack only. Never reads .env or accepts a database URL. */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, chmod, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { startLoopbackDockerProxy } from './helpers/loopback-docker-proxy.mjs';
import { runDisposableSupabaseChecks } from './disposable-rls.test.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  assert.ok(['--cli', '--docker-socket', '--runtime'].includes(name) && process.argv[index + 1], 'Usage: node tests/run-disposable-supabase.mjs --cli /path/to/supabase --docker-socket /path/to/local.sock --runtime podman|docker');
  options[name.slice(2)] = process.argv[index + 1];
}
assert.ok(options.cli && options['docker-socket'] && ['podman', 'docker'].includes(options.runtime), 'Explicit CLI, local Unix socket and runtime are required');
assert.ok(options['docker-socket'].startsWith('/'), 'Only an absolute local Unix socket path is supported');

const workdir = await mkdtemp(join(tmpdir(), 'lokalchat-db-test-'));
await chmod(workdir, 0o700);
const projectId = `lokalchat-test-${randomUUID().slice(0, 12)}`;
const result = { timestamp: new Date().toISOString(), projectId, workdir, runtime: options.runtime, migrations: [], stages: [], passed: false, cleanup: false };
const env = {};
for (const name of ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']) if (process.env[name]) env[name] = process.env[name];
Object.assign(env, { HOME: join(workdir, 'home'), XDG_CONFIG_HOME: join(workdir, 'home/.config'), DOCKER_CONFIG: join(workdir, 'docker-config'), DOCKER_HOST: `unix://${workdir}/docker.sock`, SUPABASE_TELEMETRY_DISABLED: 'true', CI: 'true' });
await mkdir(env.HOME, { recursive: true });
await mkdir(env.DOCKER_CONFIG, { recursive: true });
let proxy;
let sequence = 0;
let activeChild;
function terminate(child, signal = 'SIGTERM') {
  try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch {}
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  process.exitCode = 1;
  if (activeChild) terminate(activeChild, signal);
});

async function run(command, args, { input, timeout = 900_000, cwd = workdir, commandEnv = env, includeStderr = false } = {}) {
  const label = `${++sequence}-${command === options.cli ? args[0] : 'runtime'}`;
  const child = spawn(command, args, { cwd, env: commandEnv, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  activeChild = child;
  const chunks = [], errors = [];
  const log = createWriteStream(join(workdir, `${label}.log`), { mode: 0o600 });
  child.stdout.on('data', chunk => { chunks.push(chunk); log.write(chunk); });
  child.stderr.on('data', chunk => { errors.push(chunk); log.write(chunk); });
  let forceTimer;
  const timer = setTimeout(() => { terminate(child); forceTimer = setTimeout(() => terminate(child, 'SIGKILL'), 10_000); }, timeout);
  const status = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  }).finally(async () => { activeChild = undefined; clearTimeout(timer); clearTimeout(forceTimer); await new Promise(done => log.end(done)); });
  const stdout = Buffer.concat(chunks).toString();
  const stderr = Buffer.concat(errors).toString();
  if (status.code !== 0) throw new Error(`Command ${label} failed (${status.code ?? status.signal}); private log retained in test directory.`);
  return includeStderr ? `${stdout}\n${stderr}` : stdout;
}

async function stage(name, action) {
  console.log(`START ${name}`);
  const started = Date.now();
  try {
    const value = await action();
    result.stages.push({ name, passed: true, milliseconds: Date.now() - started });
    console.log(`PASS ${name}`);
    return value;
  } catch (error) {
    result.stages.push({ name, passed: false, milliseconds: Date.now() - started, error: error.message.split('\n')[0] });
    throw error;
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

const cli = args => run(options.cli, [...args, '--workdir', workdir]);
const runtimeEnv = { ...process.env };
// Runtime exec never receives application/provider credentials either.
for (const name of Object.keys(runtimeEnv)) if (/SUPABASE|STAGING|API_KEY|CRYPTO_KEY/.test(name)) delete runtimeEnv[name];
const dbContainer = `supabase_db_${projectId}`;
const sql = (query, input, includeStderr = false) => run(options.runtime, ['exec', '-i', dbContainer, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...(query ? ['-c', query] : ['-v', 'DISPOSABLE_TEST=true'])], { input, commandEnv: runtimeEnv, includeStderr });

async function auditResources(phase) {
  const snapshot = { phase, containers: [], volumes: [], networks: [] };
  for (const kind of ['containers', 'volumes', 'networks']) {
    const prefix = kind === 'containers' ? ['ps', '-a'] : [kind.slice(0, -1), 'ls'];
    const names = (await run(options.runtime, [...prefix, '--filter', `label=com.supabase.cli.project=${projectId}`, '--format', kind === 'containers' ? '{{.ID}}' : '{{.Name}}'], { commandEnv: runtimeEnv })).trim().split('\n').filter(Boolean);
    for (const name of names) {
      const args = kind === 'containers' ? ['inspect', name] : [kind.slice(0, -1), 'inspect', name];
      const [resource] = JSON.parse(await run(options.runtime, args, { commandEnv: runtimeEnv }));
      const labels = resource.Config?.Labels || resource.Labels || resource.labels || {};
      assert.equal(labels['com.supabase.cli.project'], projectId, `Unverified ${kind} ownership`);
      const id = resource.Id || resource.ID || resource.id || resource.Name || resource.name;
      assert.ok(id, 'Runtime resource has no identifier');
      const item = { id, name: resource.Name || resource.name, labels };
      if (kind === 'containers') {
        item.bindings = resource.NetworkSettings?.Ports || {};
        for (const bindings of Object.values(item.bindings)) {
          for (const binding of bindings || []) assert.equal(binding.HostIp, '127.0.0.1', 'Port exposed outside loopback');
        }
      }
      snapshot[kind].push(item);
    }
  }
  (result.resourceAudits ??= []).push(snapshot);
  return snapshot;
}

async function stopVerifiedProject(phase) {
  // The CLI receives only our unique project ID; verify matching runtime labels
  // before its label-scoped stop and retain the exact resource IDs for review.
  await auditResources(`${phase}:before`);
  await cli(['stop', '--project-id', projectId, '--no-backup']);
  const remaining = await auditResources(`${phase}:after`);
  for (const kind of ['containers', 'volumes', 'networks']) assert.equal(remaining[kind].length, 0, `Disposable ${kind} remain`);
}


try {
  result.cliVersion = (await run(options.cli, ['--version'])).trim();
  assert.equal(result.cliVersion, '2.83.0', 'Use tested Go CLI 2.83.0; newer native CLIs may bypass the guarded Docker socket');
  await mkdir(join(workdir, 'supabase'));
  await cp(join(root, 'supabase/migrations'), join(workdir, 'supabase/migrations'), { recursive: true });
  const filenames = (await readdir(join(root, 'supabase/migrations'))).filter(name => name.endsWith('.sql')).sort();
  assert.equal(filenames.length, 26, 'Expected all 26 canonical migrations; update verification deliberately if the chain changes');
  for (const name of filenames) result.migrations.push({ name, version: name.split('_')[0], sha256: createHash('sha256').update(await readFile(join(root, 'supabase/migrations', name))).digest('hex') });
  const [apiPort, dbPort, shadowPort] = await Promise.all([freePort(), freePort(), freePort()]);
  assert.equal(new Set([apiPort, dbPort, shadowPort]).size, 3, 'Ports must be distinct');
  const baseConfig = (await readFile(join(root, 'supabase/config.toml'), 'utf8')).replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
  await writeFile(join(workdir, 'supabase/config.toml'), `${baseConfig}\n[api]\nport = ${apiPort}\n[db]\nport = ${dbPort}\nshadow_port = ${shadowPort}\nmajor_version = 17\n[studio]\nenabled = false\n[realtime]\nenabled = false\n[analytics]\nenabled = false\n[edge_runtime]\nenabled = false\n[auth.email]\nenable_signup = true\nenable_confirmations = false\n[auth.rate_limit]\nemail_sent = 100\nsign_in_sign_ups = 100\n`, { mode: 0o600 });
  proxy = await startLoopbackDockerProxy({ upstreamSocket: options['docker-socket'], socketPath: join(workdir, 'docker.sock'), projectId });
  console.log(`Disposable project: ${projectId}; private logs: ${workdir}`);
  const excluded = 'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';
  await stage('Fresh Supabase stack and initial 26 migrations', () => cli(['start', '--exclude', excluded]));
  await stage('Verify guarded runtime and loopback bindings', async () => {
    assert.ok(proxy.createCount > 0, 'Container creation bypassed the guarded socket');
    const snapshot = await auditResources('initial-start');
    assert.ok(snapshot.containers.length >= 2, 'Expected database and API containers');
    result.guardedContainerCreates = proxy.createCount;
  });
  await stage('First verified stop cycle', () => stopVerifiedProject('first-cycle'));
  await stage('Second fresh Supabase start cycle', () => cli(['start', '--exclude', excluded]));
  await stage('Second cycle loopback audit', () => auditResources('second-start'));
  await stage('Replay all migrations with local-only reset', () => cli(['db', 'reset', '--local', '--no-seed']));
  await stage('Verify exact migration history', async () => {
    const applied = JSON.parse((await sql('select coalesce(json_agg(version order by version), \'[]\') from supabase_migrations.schema_migrations;')).trim());
    assert.deepEqual(applied, result.migrations.map(migration => migration.version));
  });
  await stage('Backend schema and PostgreSQL behavior', async () => {
    const output = await sql(null, await readFile(join(root, 'tests/disposable-schema.sql')), true);
    result.schemaChecks = output.split('\n').map(line => line.replace(/^NOTICE:\s+/, '')).filter(line => line.startsWith('PASS '));
    assert.ok(result.schemaChecks.length > 0, 'Schema suite did not emit PASS markers');
  });
  const status = await cli(['status', '-o', 'json']);
  const config = JSON.parse(status);
  result.statusFields = Object.keys(config);
  const credentials = { apiUrl: config.API_URL, publishableKey: config.ANON_KEY || config.PUBLISHABLE_KEY, serviceRoleKey: config.SERVICE_ROLE_KEY || config.SECRET_KEY };
  assert.equal(new URL(credentials.apiUrl).port, String(apiPort), 'CLI status must match our newly created API');
  await stage('Real signup, login, tenant RLS and private Storage', async () => {
    result.apiChecks = await runDisposableSupabaseChecks(credentials);
  });
  await stage('Verify API fixtures cleaned up', async () => {
    assert.equal((await sql('select count(*) from auth.users;')).trim(), '0');
  });
  result.passed = true;
} catch (error) {
  console.error(error instanceof assert.AssertionError ? `FAIL ${error.message.split('\n')[0]}` : `FAIL ${error.message}`);
  result.failure = error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.message;
  process.exitCode = 1;
} finally {
  try {
    if (proxy) {
      await stopVerifiedProject('final-cleanup');
      result.cleanup = true;
      console.log('PASS disposable containers and data volumes removed');
    }
  } catch (error) { result.cleanupFailure = error.message.split('\n')[0]; process.exitCode = 1; result.passed = false; console.error('FAIL disposable cleanup; inspect private logs and remove only the named test project'); }
  await proxy?.close();
  await mkdir(join(root, 'reports'), { recursive: true });
  await writeFile(join(root, 'reports/DISPOSABLE_SUPABASE_RESULTS.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`RESULT ${result.passed && result.cleanup ? 'PASS' : 'FAIL'}; reports/DISPOSABLE_SUPABASE_RESULTS.json`);
  // Keep private logs for diagnosis; never copy CLI output/credentials to reports.
}
