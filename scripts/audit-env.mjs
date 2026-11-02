// Static audit only: never load or print private environment values.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .trim().split('\n').filter(file => /\.(?:[cm]?[jt]sx?|toml|ya?ml)$/.test(file) && !/(^|\/)\.env/.test(file));
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
// Production framework controls already documented in README, not direct app reads.
const framework = new Set(['PORT', 'HOST']);
for (const name of referenced) if (!documented.has(name)) errors.push(`Missing from template: ${name}`);
for (const name of documented) if (!referenced.has(name) && !framework.has(name)) errors.push(`Unused template variable: ${name}`);
for (const name of documented) if (names.filter(item => item === name).length > 1) errors.push(`Duplicate: ${name}`);
const probes = ['.env', '.env.local', '.env.production', 'supabase/.env', 'supabase/.env.local', '.env.example', 'supabase/.env.example'];
const ignored = new Set(execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { input: probes.join('\n') + '\n', encoding: 'utf8' }).trim().split('\n'));
for (const file of probes) if (ignored.has(file) === file.endsWith('.example')) errors.push(`Incorrect Git ignore rule: ${file}`);
const trackedPrivate = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n')
  .filter(file => /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example'));
for (const file of trackedPrivate) errors.push(`Private env file tracked by Git: ${file}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${referenced.size} referenced variables covered; ${framework.size} documented framework controls; no unused or duplicate template variables.`);
  console.log('PASS: private env paths ignored, example paths committable, no private env files tracked.');
  console.log('Scope: literal env reads in repository source/config; no credentials, DB or provider connections checked.');
}
