// Static audit only: never load or print private environment values.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
// Work in generated projects too: scaffolding deliberately does not copy .git.
function sourceFiles(directory = '.') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || ['node_modules', 'packages', '.git', '.output', '.tanstack', 'dist', 'coverage'].includes(entry.name)) return [];
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:[cm]?[jt]sx?|toml|ya?ml)$/.test(entry.name) ? [path] : [];
  });
}
// Restrict traversal to shipped application sources. Never recurse into local
// agent/cloud configuration, backups or unrelated tool caches.
const files = ['src', 'scripts', 'tests', 'supabase', 'drizzle']
  .filter(existsSync).flatMap(directory => sourceFiles(directory))
  .concat(['vite.config.ts', 'pnpm-workspace.yaml'].filter(existsSync));
const referenced = new Set();
const errors = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const pattern = /(?:process\.env|import\.meta\.env)(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])|Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]*)["']\s*\)|env\(\s*["']([A-Z][A-Z0-9_]*)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) referenced.add(match.slice(1).find(Boolean));
}
const template = readFileSync('.env.example', 'utf8');
const names = [...template.matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]);
const documented = new Set(names);
// Framework controls are documented in README; GITHUB_REF is a CI-only control
// documented in docs/RELEASING.md, not an application credential.
const framework = new Set(['PORT', 'HOST', 'DEV', 'GITHUB_REF']);
for (const name of referenced) if (!documented.has(name) && !framework.has(name)) errors.push(`Missing from template: ${name}`);
for (const name of documented) if (!referenced.has(name) && !framework.has(name)) errors.push(`Unused template variable: ${name}`);
for (const name of documented) if (names.filter(item => item === name).length > 1) errors.push(`Duplicate: ${name}`);
const probes = ['.env', '.env.local', '.env.production', 'supabase/.env', 'supabase/.env.local', '.env.example', 'supabase/.env.example'];
let ignored;
if (!existsSync('.git')) {
  // Validate the explicit safety rules shipped in the template, without requiring Git.
  const rules = new Set(readFileSync('.gitignore', 'utf8').split(/\r?\n/).map(line => line.trim()));
  for (const rule of ['**/.env', '**/.env.*', '!**/.env.example']) {
    if (!rules.has(rule)) errors.push(`Missing template ignore rule: ${rule}`);
  }
  ignored = new Set(probes.filter(file => !file.endsWith('.example')));
} else try {
  ignored = new Set(execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { input: probes.join('\n') + '\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split('\n'));
} catch {
  throw new Error('Unable to inspect repository Git ignore rules.');
}
for (const file of probes) if (ignored.has(file) === file.endsWith('.example')) errors.push(`Incorrect Git ignore rule: ${file}`);
let trackedPrivate = [];
try {
  if (existsSync('.git')) trackedPrivate = execFileSync('git', ['ls-files'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).split('\n')
    .filter(file => /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example'));
} catch { errors.push('Unable to inspect tracked Git files.'); }
for (const file of trackedPrivate) errors.push(`Private env file tracked by Git: ${file}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${referenced.size} referenced variables covered; ${framework.size} documented framework controls; no unused or duplicate template variables.`);
  console.log(existsSync('.git') ? 'PASS: private env paths ignored, example paths committable, no private env files tracked.' : 'PASS: template env ignore rules present; Git tracking check skipped (no .git).');
  console.log('Scope: literal env reads in repository source/config; no credentials, DB or provider connections checked.');
}
