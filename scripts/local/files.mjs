import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LOCAL_CONFIG } from './config.mjs';

export async function assertNoLinks(path) {
  for (let part = path; ; part = dirname(part)) {
    try { if ((await lstat(part)).isSymbolicLink()) throw new Error('Local setup paths cannot contain symbolic links.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (part === dirname(part)) break;
  }
}

export async function optionalText(path) {
  await assertNoLinks(path);
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

export async function writePrivate(path, content) {
  await assertNoLinks(path);
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally { await rm(temporary, { force: true }); }
}

export async function lockSetup(directory) {
  const path = join(directory, 'setup.lock');
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another local setup may be running. Use its terminal and Ctrl+C first. If that process has exited, remove .lokalchat/setup.lock and retry.');
    throw error;
  }
  await file.writeFile(`${process.pid}\n`);
  await file.close();
  return () => rm(path);
}

export async function assertFreshEnv(app) {
  const example = await readFile(join(app, '.env.example'), 'utf8');
  for (const name of (await readdir(app)).filter(name => name === '.env' || name.startsWith('.env.') && name !== '.env.example')) {
    const content = await optionalText(join(app, name));
    if (content.trim() && !(name === '.env' && content === example)) throw new Error('This folder already has custom environment settings. Use a new installer folder for automatic local setup. Existing settings were kept.');
  }
}

export async function prepareProject(app, workdir) {
  const configPath = join(workdir, 'supabase/config.toml');
  await assertNoLinks(configPath);
  await mkdir(join(workdir, 'supabase/migrations'), { recursive: true, mode: 0o700 });
  const config = await optionalText(configPath);
  if (config !== undefined && config !== LOCAL_CONFIG) throw new Error('Managed local config was changed. Keep it for inspection; use a new folder for a fresh setup.');
  if (config === undefined) await writePrivate(configPath, LOCAL_CONFIG);
  const source = join(app, 'supabase/migrations');
  await assertNoLinks(source);
  const names = (await readdir(source)).filter(name => /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error('Application migrations are missing. Recreate the app with the installer.');
  const versions = names.map(name => name.split('_')[0]);
  if (new Set(versions).size !== versions.length) throw new Error('Duplicate migration versions.');
  for (const name of names) {
    const target = join(workdir, 'supabase/migrations', name);
    const content = await optionalText(join(source, name));
    const existing = await optionalText(target);
    if (existing !== undefined && existing !== content) throw new Error(`Migration ${name} changed after local setup. Restore the original; do not reset existing data.`);
    if (existing === undefined) await writePrivate(target, content);
  }
  const copied = (await readdir(join(workdir, 'supabase/migrations'))).filter(name => name.endsWith('.sql')).sort();
  if (JSON.stringify(copied) !== JSON.stringify(names)) throw new Error('Local migration history differs from the app. Use the original app version or a new folder.');
  return versions;
}
