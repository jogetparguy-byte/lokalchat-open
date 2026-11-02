#!/usr/bin/env node
import { chmod, cp, lstat, mkdir, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { resolve, basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
export function parseArgs(args) {
  const options = { directory: 'lokalchat-app', packageManager: 'npm', install: true };
  let directorySet = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--version' || arg === '-v') return { version: true };
    if (arg === '--skip-install') options.install = false;
    else if (arg === '--package-manager') options.packageManager = args[++i];
    else if (arg.startsWith('--package-manager=')) options.packageManager = arg.split('=')[1];
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (directorySet) throw new Error('Specify only one destination directory.');
    else { options.directory = arg; directorySet = true; }
  }
  if (!['npm', 'pnpm'].includes(options.packageManager)) throw new Error('--package-manager must be npm or pnpm.');
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

export async function createProject(options, { cwd = process.cwd(), template = join(packageRoot, 'template'), run = spawnSync, log = console.log } = {}) {
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
  await cp(join(destination, '.env.example'), join(destination, '.env'), { errorOnExist: true, force: false });
  await chmod(join(destination, '.env'), 0o600);
  const pm = options.packageManager;
  if (options.install) {
    // Include build tooling even when the caller has NODE_ENV=production.
    const args = pm === 'npm' ? ['install', '--include=dev'] : ['install', '--frozen-lockfile', '--prod=false'];
    const result = run(pm, args, { cwd: destination, stdio: 'inherit', shell: false, env: { ...process.env, NODE_ENV: 'development' } });
    if (result.error || result.status !== 0) throw new Error(`Project created at ${destination}, but dependency installation failed. Run ${pm} ${args.join(' ')} there before starting the app.`);
  }
  log(`\nCreated LokalChat at ${destination}\n\nNext steps:\n  cd ${JSON.stringify(destination)}\n${options.install ? '' : `  ${pm} install${pm === 'npm' ? ' --include=dev' : ' --frozen-lockfile --prod=false'}\n`}  # Follow README.md: create a NEW local/development Supabase project, apply migrations, then fill .env.\n  # .env contains placeholders only. Never expose a service role key in VITE_* variables.\n  ${pm} run dev\n\nNo database was contacted or migrated. No Git repository was initialized.\n`);
  return destination;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) { console.log('Usage: create-lokalchat [directory] [--package-manager npm|pnpm] [--skip-install]\nDefault directory: lokalchat-app. Node >=22.12 required. Supabase setup is manual; see generated README.md.'); return; }
  if (options.version) { console.log(JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version); return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js >=22.12.0 is required; Node 24 LTS is recommended.');
  await createProject(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href) {
  main().catch(error => { console.error(`create-lokalchat: ${error.message}`); process.exitCode = 1; });
}
