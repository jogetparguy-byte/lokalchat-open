import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
import { CLI_VERSION, LOCAL_CONFIG, applicationEnv, localConnections, localProcessEnv, parseLocalArgs } from './local/config.mjs';
import { assertFreshEnv, assertNoLinks, lockSetup, optionalText, prepareProject, writePrivate } from './local/files.mjs';
import { ensureCli } from './local/download.mjs';
import { createRunner } from './local/process.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
export const HELP = `Usage: npm run setup:local -- [options]

Prepare a separate development database and start LokalChat at http://127.0.0.1:3000.
Options:
  --runtime auto|native|docker|podman  Default: auto; reuse the saved runtime on later starts.
  --check                             Prepare and verify the database, then stop without starting the app.
  --stop                              Stop only this app's managed local database; keep its data.
  --help, -h                          Show help without downloads or database access.
  --version, -v                       Show the pinned Supabase CLI version.

First start needs internet and several minutes. Commands wait up to 15 minutes per setup step.
Docker/Podman must be running for their runtimes. Native is experimental and requires Linux
glibc 2.35+ (x64/arm64) or macOS 14+ on Apple silicon. Windows/Intel Mac need Docker/Podman.
This is local development only; email confirmation is disabled in this separate local config.
Ctrl+C stops the app and its database without deleting data. Run this command again to resume.
`;

async function checkPort() {
  const probe = createServer();
  try {
    await new Promise((done, reject) => { probe.once('error', reject); probe.listen({ port: 3000, host: '127.0.0.1', exclusive: true }, done); });
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error('Port 3000 is in use. Stop the other app in its terminal, then retry.');
    throw error;
  } finally { if (probe.listening) await new Promise(done => probe.close(done)); }
}

export async function verifyDatabase(connection, expected) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(connection.dbUrl, { max: 1, connect_timeout: 30, ssl: false });
  try {
    const rows = await sql`select version from supabase_migrations.schema_migrations order by version`;
    assert.deepEqual(rows.map(row => row.version), expected, 'Applied migration history differs from this app.');
    const tables = await sql`select to_regclass('public.profiles') as profiles, to_regclass('public.chats') as chats, to_regclass('public.messages') as messages`;
    assert(tables[0].profiles && tables[0].chats && tables[0].messages, 'Required app tables are missing.');
  } finally { await sql.end({ timeout: 5 }); }
}

async function verifyServices(connection, signal) {
  for (const path of ['/auth/v1/health', '/rest/v1/profiles?select=id&limit=1']) {
    const response = await fetch(connection.apiUrl + path, {
      headers: { apikey: connection.publicKey }, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(900_000)]),
    });
    if (!response.ok) throw new Error(`Local service returned HTTP ${response.status}. Check the private log before trying again.`);
    await response.arrayBuffer();
  }
}

// Dependencies are injectable for orchestration tests; the shipped CLI always uses real services.
export async function setupLocal(options, {
  app = appRoot, sourceEnv = process.env, signal = new AbortController().signal,
  output = console.log, errorOutput = console.error, installCli = ensureCli,
  runnerFactory = createRunner, verify = verifyDatabase, health = verifyServices,
  portCheck = checkPort, diskCheck = statfs,
} = {}) {
  const state = join(app, '.lokalchat');
  const workdir = join(state, 'project');
  const envFile = join(state, 'local.env');
  const logPath = join(state, 'setup-private.log');
  let release, log, cli, run, attempted = false, step = 'preflight', failure;
  try {
    await assertNoLinks(state);
    await mkdir(state, { recursive: true, mode: 0o700 });
    await chmod(state, 0o700);
    release = await lockSetup(state);
    const env = localProcessEnv(sourceEnv, join(state, 'supabase'));
    if (options.stop && await optionalText(join(workdir, 'supabase/config.toml')) === undefined) {
      output('No managed local database exists in this app.'); return;
    }
    await assertNoLinks(logPath);
    const file = await open(logPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW || 0), 0o600);
    await file.chmod(0o600);
    log = file.createWriteStream();
    log.on('error', () => {});
    run = runnerFactory({ cwd: workdir, env, log, signal });
    if (!options.stop) {
      await assertFreshEnv(app);
      const [major, minor] = process.versions.node.split('.').map(Number);
      if (major < 22 || major === 22 && minor < 13 || major === 23) throw new Error('Use Node.js 22.13+ or >=24; Node 24 LTS is recommended.');
      if (!options.check) await portCheck();
      const disk = await diskCheck(app);
      if (disk.bavail * disk.bsize < 1_500_000_000) throw new Error('At least 1.5 GB free disk space is required; Docker downloads may need more.');
      await lstat(join(app, 'node_modules/vite/bin/vite.js')).catch(() => { throw new Error('App dependencies are missing. Run npm install --include=dev (or pnpm install --frozen-lockfile --prod=false), then retry.'); });
    }
    // A Settings-selected connection is operator-owned. Never overwrite it or migrate that project.
    const savedAppEnv = parseEnv(await optionalText(envFile) || '');
    if (!options.stop && savedAppEnv.SUPABASE_CONFIG_SOURCE === 'settings') {
      const appEnv = { ...env, LOKALCHAT_ENV_FILE: envFile };
      step = 'saved application configuration check';
      await run(process.execPath, ['scripts/check-env.mjs'], { cwd: app, env: appEnv });
      output('Using Supabase saved in Settings. No local database is started or migrated; prepare the selected project separately.');
      if (options.check) output('PASS: saved configuration format. Connection, schema and credentials were not tested.');
      else {
        step = 'application start';
        output('Open http://127.0.0.1:3000. Restart loads the saved Supabase settings.');
        await run(process.execPath, ['scripts/dev.mjs'], { cwd: app, env: appEnv, visible: true, timeout: 0 });
      }
      return;
    }
    // The dedicated workdir contains no hosted link or application .env files.
    const expected = options.stop ? [] : await prepareProject(app, workdir);
    if (options.stop && await optionalText(join(workdir, 'supabase/config.toml')) !== LOCAL_CONFIG) throw new Error('Managed local config was changed. Restore it before stopping this database.');
    await assertNoLinks(join(state, 'supabase'));
    await assertNoLinks(join(state, 'cli', CLI_VERSION));
    step = 'Supabase CLI download/verification';
    output(`[1/5] Preparing Supabase CLI ${CLI_VERSION}. First download can take several minutes.`);
    cli = await installCli(join(state, 'cli', CLI_VERSION), { signal });
    if ((await run(cli, ['--version'], { capture: true })).trim() !== CLI_VERSION) throw new Error('Unexpected Supabase CLI version.');
    if (options.stop) {
      step = 'stopping the local database';
      await run(cli, ['stop'], { timeout: 60_000 });
      output('Local database stopped. Data kept.'); return;
    }
    step = 'local database start';
    output('[2/5] Starting the local database. Runtime downloads can take several minutes.');
    output(`Private progress log: ${logPath}. Do not share this file; it may contain keys.`);
    output('Local setup uses experimental Supabase stacks. No automatic retries.');
    attempted = true;
    const runtimeArgs = options.runtime === 'auto' ? [] : ['--runtime', options.runtime];
    await run(cli, ['start', ...runtimeArgs, '--preparation', 'on-demand', '--exclude', 'realtime,functions,studio,mail,analytics,pooler']);
    step = 'local migrations';
    output('[3/5] Applying and checking app migrations. Existing data is kept.');
    await run(cli, ['migration', 'up', '--yes']);
    const connection = localConnections(await run(cli, ['status', '--env', '--output-format', 'text'], { capture: true }));
    await verify(connection, expected);
    step = 'Auth and REST health checks';
    output(`[4/5] ${expected.length} migrations verified. Checking Auth and REST; first use downloads these services.`);
    await health(connection, signal);
    const old = parseEnv(await optionalText(envFile) || '');
    if (old.WHATSAPP_CRYPTO_KEY && !/^[a-f0-9]{64}$/i.test(old.WHATSAPP_CRYPTO_KEY)) throw new Error('Saved encryption key is invalid. Keep local.env for inspection; do not replace the key.');
    const cryptoKey = old.WHATSAPP_CRYPTO_KEY || randomBytes(32).toString('hex');
    await writePrivate(envFile, applicationEnv(connection, cryptoKey, old));
    const appEnv = { ...env, LOKALCHAT_ENV_FILE: envFile };
    step = 'application configuration check';
    await run(process.execPath, ['scripts/check-env.mjs'], { cwd: app, env: appEnv });
    if (options.check) output('[5/5] PASS: local migrations, Auth, REST and app configuration. Database will stop; data is kept.');
    else {
      step = 'application start';
      output('[5/5] Open http://127.0.0.1:3000 and register a test account.');
      output('Keep this terminal open. Ctrl+C stops this app and database; data is kept.');
      output('WhatsApp and AI require separate configuration.');
      await run(process.execPath, ['scripts/dev.mjs'], { cwd: app, env: appEnv, visible: true, timeout: 0 });
    }
  } catch (error) {
    failure = error;
    log?.write(`\n${step}: ${error.stack || error}\n`);
    // Arbitrary child/database errors can contain secrets. Expose only known preflight guidance.
    if (step === 'preflight') errorOutput(error.message);
    else errorOutput(`Local setup stopped during ${step}. Inspect the private log on this computer: ${logPath}. Do not share its contents.`);
  } finally {
    if (attempted && cli && run) {
      try { await run(cli, ['stop'], { cleanup: true, timeout: 60_000 }); }
      catch {
        errorOutput('Local database could not be stopped. Run npm run stop:local from this app after this command exits. Data was not reset.');
        failure ??= new Error('Local database cleanup failed.');
      }
    }
    if (log) await new Promise(done => log.end(done));
    await release?.();
  }
  if (failure) throw failure;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseLocalArgs(args);
  if (options.help) { console.log(HELP); return; }
  if (options.version) { console.log(CLI_VERSION); return; }
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Setup cancelled. Data kept. Run npm run setup:local again to resume.'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try { await setupLocal(options, { signal: controller.signal }); }
  catch { process.exitCode = controller.signal.aborted ? 130 : 1; }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
