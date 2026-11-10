import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

// Exercise the real npm bin installation and entrypoint, rather than importing
// createProject. No registry, application dependencies or database are needed.
const args = process.argv.slice(2);
assert(args.length === 1, 'Usage: npm run test:package -- /absolute/path/create-lokalchat-VERSION.tgz');
const archive = resolve(args[0]);
assert(archive.endsWith('.tgz'), 'Pass a packed .tgz archive, not the source directory.');
await access(archive);
const npmCli = process.env.npm_execpath;
assert(npmCli && basename(npmCli) === 'npm-cli.js', 'Run this check with npm run test:package.');
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const sandbox = await mkdtemp(join(tmpdir(), 'lokalchat-npx-smoke-'));
const destination = join(sandbox, 'lokalchat-app');
const outputDirectory = join(sandbox, 'checks');
await mkdir(outputDirectory);
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;

async function npx(cliArgs, expectedStatus = 0) {
  const commandArgs = [npmCli, 'exec', '--offline', '--yes', '--cache', join(sandbox, 'npm-cache'),
    '--package', archive, '--', 'lokalchat', ...cliArgs];
  // File descriptors also work on hosts that cannot capture subprocess pipes.
  const stdoutPath = join(outputDirectory, 'stdout');
  const stderrPath = join(outputDirectory, 'stderr');
  const stdoutFile = await open(stdoutPath, 'w', 0o600);
  const stderrFile = await open(stderrPath, 'w', 0o600);
  const child = spawn(process.execPath, commandArgs, { cwd: sandbox, env, shell: false, stdio: ['ignore', stdoutFile.fd, stderrFile.fd] });
  const timer = setTimeout(() => child.kill(), 60_000);
  try {
    const status = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', done);
    });
    const stdout = await readFile(stdoutPath, 'utf8');
    const stderr = await readFile(stderrPath, 'utf8');
    assert.equal(status, expectedStatus, `npm exec failed: ${stderr || stdout}`);
    return { stdout, stderr };
  } finally {
    clearTimeout(timer);
    await stdoutFile.close();
    await stderrFile.close();
  }
}

try {
  assert.equal((await npx(['--version'])).stdout.trim(), manifest.version);
  assert.match((await npx(['--help'])).stdout, /Usage: create-lokalchat/);
  assert.deepEqual((await readdir(sandbox)).filter(name => !['npm-cache', 'checks'].includes(name)), [], 'Help/version must not scaffold a project.');
  for (const shell of ['bash', 'zsh', 'fish']) assert.match((await npx(['--completions', shell])).stdout, /setup-local/);

  await npx(['--skip-install']);
  const generated = JSON.parse(await readFile(join(destination, 'package.json')));
  assert.equal(generated.name, 'lokalchat-app');
  assert.equal(generated.scripts['setup:local'], 'node scripts/setup-local.mjs');
  assert.equal(await readFile(join(destination, '.env'), 'utf8'), await readFile(join(destination, '.env.example'), 'utf8'));
  if (process.platform !== 'win32') assert.equal((await stat(join(destination, '.env'))).mode & 0o777, 0o600);
  for (const name of ['.git', '.lokalchat', 'node_modules']) await assert.rejects(access(join(destination, name)), { code: 'ENOENT' });
  for (const name of ['.gitignore', 'package-lock.json', 'pnpm-lock.yaml', 'scripts/setup-local.mjs', 'supabase/migrations', 'src']) await access(join(destination, name));

  const original = await readFile(join(destination, 'package.json'), 'utf8');
  assert.match((await npx(['--skip-install'], 1)).stderr, /new or empty directory/);
  assert.equal(await readFile(join(destination, 'package.json'), 'utf8'), original);
  await npx(['My LokalChat', '--skip-install', '--package-manager', 'pnpm']);
  assert.equal(JSON.parse(await readFile(join(sandbox, 'My LokalChat/package.json'))).name, 'my-lokalchat');
  assert.match((await npx(['invalid', '--skip-install', '--setup-local'], 1)).stderr, /requires dependency installation/);
  await assert.rejects(access(join(sandbox, 'invalid')), { code: 'ENOENT' });

  console.log(`PASS: ${manifest.name}@${manifest.version} through npm exec (npx), with an isolated offline cache.`);
  console.log('Verified help, version, completions, default/named scaffolds, private placeholder env and refusal to overwrite.');
  console.log(`Archive: ${archive}`);
  console.log(`SHA-256: ${createHash('sha256').update(await readFile(archive)).digest('hex')}`);
  console.log('Scope: scaffolding only. Dependency installation, local database setup and registry publication were not exercised.');
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
