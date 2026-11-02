// Offline setup check. Never print environment values or contact a provider.
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function privileged(value = '') {
  if (value.startsWith('sb_secret_')) return true;
  try {
    const claims = JSON.parse(Buffer.from(value.split('.')[1] || '', 'base64url').toString());
    return claims.role === 'service_role';
  } catch { return false; }
}

export function validateEnvironment(env) {
  const errors = [];
  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  for (const name of required) {
    if (!env[name]?.trim() || /REPLACE_ME/i.test(env[name])) errors.push(`${name}: replace the placeholder with your own development project configuration.`);
  }
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('VITE_') && (privileged(value) || /SECRET|SERVICE_ROLE|PASSWORD|CRYPTO|PRIVATE|API_KEY|TOKEN/.test(name))) {
      errors.push(`${name}: privileged credentials must never use the public VITE_ prefix. Remove this variable before building.`);
    }
  }
  if (privileged(env.SUPABASE_PUBLISHABLE_KEY)) errors.push('SUPABASE_PUBLISHABLE_KEY: use a publishable or legacy anon key, never a privileged key.');
  for (const name of ['VITE_SUPABASE_URL', 'SUPABASE_URL']) {
    if (!env[name] || /REPLACE_ME/i.test(env[name])) continue;
    try {
      const url = new URL(env[name]);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error();
    } catch { errors.push(`${name}: use an HTTPS project origin or a local HTTP origin, without credentials or a path.`); }
  }
  if (env.VITE_SUPABASE_URL && env.SUPABASE_URL && env.VITE_SUPABASE_URL.replace(/\/$/, '') !== env.SUPABASE_URL.replace(/\/$/, '')) errors.push('Supabase client and server URLs must refer to the same project.');
  if (env.VITE_SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_PUBLISHABLE_KEY && env.VITE_SUPABASE_PUBLISHABLE_KEY !== env.SUPABASE_PUBLISHABLE_KEY) errors.push('Supabase client and server publishable keys must match.');
  return errors;
}

export function main() {
  const envFile = process.env.LOKALCHAT_ENV_FILE || '.env';
  if (!existsSync(envFile)) {
    console.error('Environment file missing. Copy .env.example to .env and configure your own development project.');
    process.exitCode = 1;
    return;
  }
  const env = { ...parseEnv(readFileSync(envFile, 'utf8')), ...process.env };
  const errors = validateEnvironment(env);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('PASS: required setup values present; public credential and project consistency checks passed. Offline check only: database, migrations, credentials and provider connectivity are not verified.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch { console.error('Setup check could not read configuration. Use a readable .env file with valid environment syntax; no values were logged.'); process.exitCode = 1; }
}
