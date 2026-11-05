import { parseEnv } from 'node:util';

export const CLI_VERSION = '3.0.0';
export const LOCAL_CONFIG = `# Managed development database. Never link this directory to a hosted project.
project_id = "lokalchat-local"
[experimental]
stack = true
[db]
major_version = 17
health_timeout = "120s"
[db.seed]
enabled = false
[auth]
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["http://127.0.0.1:3000/dashboard"]
[auth.email]
enable_signup = true
enable_confirmations = false
`;

export function parseLocalArgs(args) {
  const options = { runtime: 'auto', check: false, stop: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--version' || arg === '-v') return { version: true };
    if (arg === '--check') options.check = true;
    else if (arg === '--stop') options.stop = true;
    else if (arg === '--runtime') options.runtime = args[++i];
    else if (arg.startsWith('--runtime=')) options.runtime = arg.slice('--runtime='.length);
    else throw new Error(`Unknown option: ${arg}. Run npm run setup:local -- --help.`);
  }
  if (!['auto', 'native', 'docker', 'podman'].includes(options.runtime)) throw new Error('--runtime must be auto, native, docker or podman.');
  if (options.check && options.stop) throw new Error('--check and --stop cannot be combined.');
  return options;
}

function privileged(value) {
  if (value.startsWith('sb_secret_')) return true;
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).role === 'service_role'; }
  catch { return false; }
}

export function localConnections(output) {
  const values = parseEnv(output);
  let api, db;
  try { api = new URL(values.API_URL); db = new URL(values.DB_URL); }
  catch { throw new Error('Local Supabase did not return valid connection URLs.'); }
  for (const url of [api, db]) {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Refusing a connection outside this computer.');
  }
  if (api.protocol !== 'http:' || api.username || api.password || api.pathname !== '/' || api.search || api.hash
    || !['postgres:', 'postgresql:'].includes(db.protocol) || db.search || db.hash) throw new Error('Invalid local connection settings.');
  const publicKey = values.PUBLISHABLE_KEY || values.ANON_KEY;
  const secretKey = values.SECRET_KEY || values.SERVICE_ROLE_KEY;
  if (!publicKey || !secretKey || publicKey === secretKey || privileged(publicKey)) throw new Error('Local Supabase keys are missing or unsafe for the browser.');
  return { apiUrl: api.origin, dbUrl: db.href, publicKey, secretKey };
}

// Do not pass hosted targets, Node preload flags, or AI/WhatsApp credentials to children.
export function localProcessEnv(source, state) {
  const env = {};
  for (const name of ['PATH', 'Path', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'XDG_RUNTIME_DIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'CONTAINER_HOST']) {
    if (source[name]) env[name] = source[name];
  }
  return { ...env, SUPABASE_HOME: state, SUPABASE_TELEMETRY_DISABLED: 'true' };
}

export function applicationEnv(connection, cryptoKey, previous = {}) {
  return '# Private local development settings. Never commit or share this file.\n' + Object.entries({
    VITE_SUPABASE_URL: connection.apiUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: connection.publicKey,
    SUPABASE_URL: connection.apiUrl,
    SUPABASE_PUBLISHABLE_KEY: connection.publicKey,
    SUPABASE_SERVICE_ROLE_KEY: connection.secretKey,
    WHATSAPP_CRYPTO_KEY: cryptoKey,
    // Settings writes these to local.env; keep them when refreshing local DB keys.
    ...Object.fromEntries(['AI_PROVIDER', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_CONFIG_SOURCE'].filter(name => previous[name] !== undefined).map(name => [name, previous[name]])),
  }).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
}
