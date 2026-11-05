#!/usr/bin/env node
import { chmod, cp, lstat, mkdir, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { resolve, basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { completions } from './completions.mjs';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
export function parseArgs(args) {
  const options = { directory: 'lokalchat-app', packageManager: 'npm', install: true };
  let directorySet = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--version' || arg === '-v') return { version: true };
    if (arg === '--completions') { const shell = args[++i]; completions(shell); return { completions: shell }; }
    if (arg === '--skip-install') options.install = false;
    else if (arg === '--setup-local') options.setupLocal = true;
    else if (arg === '--package-manager') options.packageManager = args[++i];
    else if (arg.startsWith('--package-manager=')) options.packageManager = arg.split('=')[1];
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (directorySet) throw new Error('Specify only one destination directory.');
    else { options.directory = arg; directorySet = true; }
  }
  if (!['npm', 'pnpm'].includes(options.packageManager)) throw new Error('--package-manager must be npm or pnpm.');
  if (options.setupLocal && !options.install) throw new Error('--setup-local requires dependency installation. Remove --skip-install, or run setup:local later.');
  return options;
}

async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Validate before copying: fs.cp can otherwise follow links outside the template.
export async function assertTemplateSafe(directory) {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink()) throw new Error('Template cannot contain symbolic links.');
  if (stat.isDirectory()) {
    for (const entry of await readdir(directory)) await assertTemplateSafe(join(directory, entry));
  } else if (!stat.isFile()) throw new Error('Template can contain only regular files and directories.');
}

// npm and pnpm are .cmd launchers on Windows. Use only fixed arguments here;
// user-supplied paths go through cwd, never through the command shell.
export function installCommand(pm, args, { platform = process.platform, env = process.env, execPath = process.execPath } = {}) {
  if (pm === 'npm' && env.npm_execpath && basename(env.npm_execpath) === 'npm-cli.js') {
    return [execPath, [env.npm_execpath, ...args]];
  }
  if (platform === 'win32') {
    return [env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${pm}.cmd ${args.join(' ')}`]];
  }
  return [pm, args];
}

export function runInstall(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, options);
    let interrupted = false;
    const interrupt = () => { interrupted = true; child.kill('SIGINT'); };
    process.once('SIGINT', interrupt);
    const cleanup = () => process.removeListener('SIGINT', interrupt);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (status, signal) => {
      cleanup();
      resolveRun({ status, interrupted: interrupted || signal === 'SIGINT' });
    });
  });
}

export async function createProject(options, { cwd = process.cwd(), template = join(packageRoot, 'template'), run = runInstall, log = console.log } = {}) {
  const destination = resolve(cwd, options.directory);
  // Check every existing component: cp must never write through a symlink.
  for (let part = destination; ; part = dirname(part)) {
    const stat = await exists(part);
    if (stat?.isSymbolicLink()) throw new Error('Destination paths containing symbolic links are not supported.');
    if (part === dirname(part)) break;
  }
  const stat = await exists(destination);
  if (stat && (!stat.isDirectory() || (await readdir(destination)).length)) throw new Error('Destination must be a new or empty directory; no files were overwritten.');
  if (!(await exists(join(template, 'package.json')))) throw new Error('Installer template is missing. Maintainers: run npm run prepare:template before packaging.');
  await assertTemplateSafe(template);
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(template)) {
    await cp(join(template, entry), join(destination, entry), { recursive: true, force: false, errorOnExist: true });
  }
  await rename(join(destination, 'gitignore'), join(destination, '.gitignore'));
  const manifestPath = join(destination, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  let name = basename(destination).toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[._-]+/, '').slice(0, 214) || 'lokalchat-app';
  if (['node_modules', 'favicon.ico'].includes(name)) name = 'lokalchat-app';
  manifest.name = name;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const lockPath = join(destination, 'package-lock.json');
  if (await exists(lockPath)) {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.name = name;
    if (lock.packages?.['']) lock.packages[''].name = name;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  }
  await cp(join(destination, '.env.example'), join(destination, '.env'), { errorOnExist: true, force: false });
  await chmod(join(destination, '.env'), 0o600);
  const pm = options.packageManager;
  if (options.install) {
    // Include build tooling even when the caller has NODE_ENV=production.
    const args = pm === 'npm' ? ['install', '--include=dev'] : ['install', '--frozen-lockfile', '--prod=false'];
    log(`Installing dependencies with ${pm}. This can take several minutes on the first run.`);
    const [command, commandArgs] = installCommand(pm, args);
    let result;
    try {
      result = await run(command, commandArgs, { cwd: destination, stdio: 'inherit', shell: false, env: { ...process.env, NODE_ENV: 'development' } });
    } catch {
      result = { status: 1 };
    }
    if (result.interrupted) {
      const error = new Error(`Installation cancelled. Project kept at ${destination}. Resume with ${pm} ${args.join(' ')} in that folder.`);
      error.exitCode = 130;
      throw error;
    }
    if (result.error || result.status !== 0) throw new Error(`Project created at ${destination}, but dependency installation failed. Run ${pm} ${args.join(' ')} there before starting the app.`);
  }
  log(`\nCreated LokalChat at ${destination}\n\nNext steps:\n  cd ${JSON.stringify(destination)}\n${options.install ? '' : `  ${pm} install${pm === 'npm' ? ' --include=dev' : ' --frozen-lockfile --prod=false'}\n`}  ${pm} run setup:local\n\nLocal setup downloads Supabase CLI, creates a separate development database, applies migrations and starts the app.\nFirst start needs internet and can take several minutes. Ctrl+C stops it and keeps data.\nFor a hosted project, follow docs/INSTALL.md instead.\nNo database was contacted during scaffolding. No Git repository was initialized.\n`);
  if (options.setupLocal) {
    log('Starting automatic local development setup. Keep this terminal open.');
    const result = await run(process.execPath, ['scripts/setup-local.mjs'], { cwd: destination, stdio: 'inherit', shell: false, env: process.env });
    if (result.interrupted) {
      const error = new Error(`Local setup cancelled. Project and data kept. Resume with ${pm} run setup:local in ${destination}.`);
      error.exitCode = 130;
      throw error;
    }
    if (result.status !== 0) throw new Error(`Local setup did not finish. Project kept at ${destination}. Follow the displayed error, then run ${pm} run setup:local there.`);
  }
  return destination;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) { console.log('Usage: create-lokalchat [directory] [--package-manager npm|pnpm] [--skip-install] [--setup-local]\nDefault directory: lokalchat-app. Node 22.13+ or >=24 required. Node 23 is unsupported.\n--setup-local: after installing dependencies, prepare a separate local database and start the app. First start needs internet.\n--completions bash|zsh|fish: print shell completion definitions.\nDefault: scaffold only; run npm run setup:local in the new folder when ready. Hosted setup: see docs/INSTALL.md.'); return; }
  if (options.version) { console.log(JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version); return; }
  if (options.completions) { console.log(completions(options.completions)); return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13) || major === 23) throw new Error('Node.js 22.13+ or >=24 is required; Node 23 is unsupported. Node 24 LTS is recommended.');
  await createProject(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href) {
  main().catch(error => { console.error(`create-lokalchat: ${error.message}`); process.exitCode = error.exitCode || 1; });
}
