import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] || '/home/irsyad_b/lokalchat-open');
const output = process.env.LOKALCHAT_AUDIT_OUTPUT || dirname(fileURLToPath(import.meta.url));
const require = createRequire(root + '/package.json');
const ts = require('typescript');
const fflate = require('fflate');
const checks = [];
function load(relative, dependencies = {}, globals = {}) {
  const source = readFileSync(root + '/' + relative, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('node:')) return require(name);
    throw Error('Unexpected dependency ' + name);
  }, URL, Headers, Request, Response, AbortSignal, Buffer, Uint8Array, Date, console, process: { env: {} }, ...globals });
  return module.exports;
}
async function check(name, fn) {
  const detail = await fn();
  checks.push({ name, passed: true, detail });
  console.log('PASS', name, detail ? JSON.stringify(detail) : '');
  writeFileSync(output + '/security-probes.json', JSON.stringify(checks, null, 2));
}

await check('SSRF literal private and alternative IP spellings rejected', async () => {
  const guard = load('src/lib/ssrf.server.ts', {}, { fetch() { throw Error('Unexpected network access'); } });
  const urls = ['http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1', 'http://10.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'file:///etc/passwd'];
  for (const url of urls) await assert.rejects(guard.assertPublicHttpUrl(url));
  return { cases: urls.length, networkRequests: 0 };
});

await check('Confirmed gap: validated DNS address is not bound to returned outbound hostname', async () => {
  const lookups = [];
  const guard = load('src/lib/ssrf.server.ts', {}, { async fetch(url) {
    lookups.push(String(url));
    return Response.json({ Answer: [{ type: 1, data: '93.184.216.34' }, { type: 28, data: '::1' }] });
  } });
  const validated = await guard.assertPublicHttpUrl('http://audit-rebinding.example:8080/inventory');
  assert.equal(validated.hostname, 'audit-rebinding.example');
  assert.equal(lookups.length, 1);
  assert.equal(new URL(lookups[0]).searchParams.get('type'), 'A');
  return { checked: 'A only via DoH', returned: 'original hostname', impact: 'Actual system resolver/connect path remains unpinned; live rebinding not attempted' };
});

await check('Confirmed gap: small DOCX expands past 10 MiB upload ceiling', async () => {
  const xml = '<w:document><w:p>' + 'A'.repeat(12 * 1024 * 1024) + '</w:p></w:document>';
  const archive = fflate.zipSync({ 'word/document.xml': fflate.strToU8(xml) }, { level: 9 });
  assert.ok(archive.length < 10 * 1024 * 1024);
  const extractor = load('src/lib/kb-extract.server.ts', { fflate });
  const result = await extractor.extractDocumentText('DOCX', archive);
  assert.equal(result.length, 12 * 1024 * 1024);
  return { uploadBytes: archive.length, extractedCharacters: result.length, boundedProbe: true };
});

await check('Confirmed gap: arbitrary provider error body reaches embedding logs', async () => {
  const sentinel = 'AUDIT_ONLY_SYNTHETIC_KEY_DO_NOT_USE';
  const logs = [];
  const embedding = load('src/lib/embeddings.server.ts', { './llm-env.server': { getSavedLlmConfig: async () => ({ baseUrl: 'https://api.openai.com/v1', apiKey: sentinel }) } }, {
    fetch: async () => new Response('Invalid key: ' + sentinel, { status: 401 }),
    console: { error: (...args) => logs.push(args.join(' ')) },
  });
  assert.equal(await embedding.createEmbedding('Synthetic audit text', 'owner-a'), null);
  assert.ok(logs.some(line => line.includes(sentinel)));
  return { syntheticSensitiveBodyLogged: true, realProviderContacted: false };
});

await check('Auth middleware verifies claims but does not consult revoked session state', async () => {
  let checkedClaims = 0;
  const auth = load('src/integrations/supabase/auth-middleware.ts', {
    '@tanstack/react-start': { createMiddleware: () => ({ server: fn => fn }) },
    '@tanstack/react-start/server': { getRequest: () => new Request('https://audit.invalid', { headers: { authorization: 'Bearer synthetic.jwt.token' } }) },
    '@supabase/supabase-js': { createClient: () => ({ auth: {
      getClaims: async () => { checkedClaims++; return { data: { claims: { sub: '11111111-1111-4111-8111-111111111111', session_id: 'synthetic-already-revoked-session' } }, error: null }; },
      getUser: () => assert.fail('Unexpected session lookup'),
    } }) },
  }, { process: { env: { SUPABASE_URL: 'https://audit.invalid', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_audit_only' } } });
  let continued = false;
  await auth.requireSupabaseAuth({ next: async () => { continued = true; } });
  assert.ok(continued && checkedClaims === 1);
  return { realTokenUsed: false, confirms: 'middleware relies on claim validity only; revocation not modeled by getClaims' };
});

await check('Webhook rejects missing, incorrect and tampered signatures before ingestion', async () => {
  const crypto = load('src/lib/wa-crypto.server.ts', {}, { process: { env: { WHATSAPP_CRYPTO_KEY: 'audit-only-synthetic-encryption-key' } } });
  const appSecret = 'audit-only-app-secret';
  const ingested = [];
  const connection = { business_id: 'trusted-owner-a', app_secret_encrypted: crypto.encryptSecret(appSecret) };
  const route = load('src/routes/api/public/whatsapp.ts', {
    '@tanstack/react-router': { createFileRoute: () => options => options },
    '@/integrations/supabase/client.server': { supabaseAdmin: { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: connection }) }; } } },
    '@/lib/wa-crypto.server': crypto,
    '@/lib/agent.server': { ingestCustomerMessage: async value => ingested.push(value) },
  }, { console: { error() {} } });
  const handler = route.Route.server.handlers.POST;
  const body = JSON.stringify({ business_id: 'attacker-selected-other-owner', entry: [{ changes: [{ value: { metadata: { phone_number_id: 'known-phone-id' }, messages: [{ id: 'audit-unique-id', type: 'text', from: '60000000000', text: { body: 'audit synthetic text' } }] } }] }] });
  const signature = 'sha256=' + createHmac('sha256', appSecret).update(body).digest('hex');
  const changedSignature = signature.slice(0, 7) + (signature[7] === '0' ? '1' : '0') + signature.slice(8);
  for (const sig of [undefined, 'sha256=wrong', changedSignature]) {
    const headers = sig ? { 'x-hub-signature-256': sig } : {};
    const response = await handler({ request: new Request('https://audit.invalid/api/public/whatsapp', { method: 'POST', headers, body }) });
    assert.equal(response.status, 401);
  }
  assert.equal(ingested.length, 0);
  const response = await handler({ request: new Request('https://audit.invalid/api/public/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body }) });
  assert.equal(response.status, 200);
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].businessId, 'trusted-owner-a');
  return { rejected: 3, correctlySigned: 1, tenantSelectedBy: 'server connection lookup' };
});

await check('WhatsApp encryption randomizes ciphertext and detects tampering', async () => {
  const crypto = load('src/lib/wa-crypto.server.ts', {}, { process: { env: { WHATSAPP_CRYPTO_KEY: 'audit-only-synthetic-encryption-key' } } });
  const a = crypto.encryptSecret('audit-only-plaintext');
  const b = crypto.encryptSecret('audit-only-plaintext');
  assert.notEqual(a,b);
  assert.equal(crypto.decryptSecret(a), 'audit-only-plaintext');
  const modified = Buffer.from(a, 'base64');modified[modified.length-1] ^= 1;
  assert.throws(() => crypto.decryptSecret(modified.toString('base64')));
  return { cipher: 'AES-256-GCM', tamperRejected: true };
});
