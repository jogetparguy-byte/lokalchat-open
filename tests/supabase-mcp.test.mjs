import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { authenticateAccount, revokeAccountSessions } from '../src/lib/account-store.server.ts';
import { envPath, updateEnvSettings } from '../src/lib/env-file.server.ts';
import { handleSupabaseMcp } from '../src/lib/supabase-mcp.server.ts';

test('MCP OAuth account binding, PKCE, replay, denial, secret storage and refresh', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lokalchat-mcp-'));
  const previous = { db: process.env.LOKALCHAT_ACCOUNT_DB, env: process.env.LOKALCHAT_USER_ENV_DIR };
  process.env.LOKALCHAT_ACCOUNT_DB = join(dir, 'accounts.sqlite');
  process.env.LOKALCHAT_USER_ENV_DIR = join(dir, 'users');
  const realFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = realFetch;
    if (previous.db === undefined) delete process.env.LOKALCHAT_ACCOUNT_DB; else process.env.LOKALCHAT_ACCOUNT_DB = previous.db;
    if (previous.env === undefined) delete process.env.LOKALCHAT_USER_ENV_DIR; else process.env.LOKALCHAT_USER_ENV_DIR = previous.env;
    await rm(dir, { recursive: true, force: true });
  });
  const a = await authenticateAccount({email:'mcp-a@example.test', password:'mcp-test-strong-pass'}, true);
  const b = await authenticateAccount({email:'mcp-b@example.test', password:'mcp-test-strong-pass'}, true);
  const origin = 'http://localhost:3000';
  const endpoint = origin + '/api/supabase/mcp';
  const req = (session = a.token, method = 'GET', suffix = '', requestOrigin = origin) => new Request(endpoint + suffix, { method, headers: { cookie: `lokalchat_session=${session}`, origin: requestOrigin, 'content-type': 'application/json' } });
  let challenge, exchanges = 0, registrations = 0, failMcp = false, sse = false;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/.well-known/oauth-authorization-server')) return Response.json({ issuer: 'https://api.supabase.com', authorization_endpoint:'https://api.supabase.com/v1/oauth/authorize', token_endpoint:'https://api.supabase.com/v1/oauth/token', registration_endpoint:'https://api.supabase.com/platform/oauth/apps/register' });
    if (target.endsWith('/platform/oauth/apps/register')) {
      registrations++;
      assert.deepEqual(JSON.parse(init.body).redirect_uris, [endpoint]);
      return Response.json({ client_id:'fixture-client', client_secret:'fixture-client-secret' }, {status:201});
    }
    if (target.endsWith('/v1/oauth/token')) {
      exchanges++;
      assert.match(init.headers.Authorization, /^Basic /);
      if (init.body.get('grant_type') === 'authorization_code') {
        assert.equal(createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'), challenge);
        assert.equal(init.body.get('redirect_uri'), endpoint);
      } else assert.equal(init.body.get('refresh_token'), 'fixture-refresh-secret');
      return Response.json({access_token:'fixture-access-secret',refresh_token:'fixture-refresh-secret',token_type:'bearer',expires_in:3600});
    }
    assert.equal(target, 'https://mcp.supabase.com/mcp');
    assert.equal(init.headers.Authorization, 'Bearer fixture-access-secret');
    if (failMcp) return Response.json({error:'failure'}, {status:401});
    const result = {jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-03-26',serverInfo:{name:'Supabase',version:'1'}}};
    return sse ? new Response(`event: message\ndata: ${JSON.stringify(result)}\n\n`, {headers:{'content-type':'text/event-stream'}}) : Response.json(result);
  };
  assert.equal((await handleSupabaseMcp(req('invalid'))).status, 401);
  assert.equal((await handleSupabaseMcp(req(a.token,'POST','','https://attacker.test'))).status, 403);
  assert.deepEqual(await (await handleSupabaseMcp(req())).json(), {connected:false,needsReconnect:false});
  const start = await (await handleSupabaseMcp(req(a.token, 'POST'))).json();
  assert.deepEqual(Object.keys(start), ['authorizationUrl']);
  assert.ok(!JSON.stringify(start).includes('fixture-client-secret'));
  const auth = new URL(start.authorizationUrl);
  assert.equal(auth.origin, 'https://api.supabase.com');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  challenge = auth.searchParams.get('code_challenge');
  const state = auth.searchParams.get('state');
  assert.equal((await handleSupabaseMcp(req(a.token, 'POST'))).status, 429);
  const suffix = `?code=fixture-code&state=${state}`;
  assert.match((await handleSupabaseMcp(req(b.token,'GET',suffix))).headers.get('location'), /failed/);
  assert.match((await handleSupabaseMcp(req(a.token,'GET','?code=fixture-code&state=wrong'))).headers.get('location'), /failed/);
  assert.equal(exchanges, 0);
  assert.match((await handleSupabaseMcp(req(a.token,'GET',suffix))).headers.get('location'), /connected/);
  assert.match((await handleSupabaseMcp(req(a.token,'GET',suffix))).headers.get('location'), /failed/);
  assert.equal(exchanges, 1);
  const status = await (await handleSupabaseMcp(req())).json();
  assert.deepEqual(status, {connected:true,needsReconnect:false});
  assert.deepEqual(await (await handleSupabaseMcp(req(b.token))).json(), {connected:false,needsReconnect:false});
  assert.equal((await stat(envPath(a.user.id))).mode & 0o777, 0o600);
  const content = await readFile(envPath(a.user.id),'utf8');
  assert.ok(!JSON.stringify(status).includes('secret'));
  assert.ok(!content.includes('SUPABASE_SERVICE_ROLE_KEY'));
  await updateEnvSettings(a.user.id, env => {
    const connection = JSON.parse(Buffer.from(env.SUPABASE_MCP_CONNECTION,'base64url').toString());
    connection.expires = 0;
    return {SUPABASE_MCP_CONNECTION: Buffer.from(JSON.stringify(connection)).toString('base64url')};
  });
  sse = true;
  assert.equal((await (await handleSupabaseMcp(req())).json()).connected, true);
  assert.equal(exchanges, 2);
  const reconnect = new URL((await (await handleSupabaseMcp(req(a.token,'POST'))).json()).authorizationUrl);
  assert.equal(registrations, 1);
  const cancel = `?error=access_denied&state=${reconnect.searchParams.get('state')}`;
  assert.match((await handleSupabaseMcp(req(a.token,'GET',cancel))).headers.get('location'), /cancelled/);
  assert.match((await handleSupabaseMcp(req(a.token,'GET',cancel))).headers.get('location'), /failed/);
  const failed = new URL((await (await handleSupabaseMcp(req(b.token,'POST'))).json()).authorizationUrl);
  challenge = failed.searchParams.get('code_challenge');
  failMcp = true;
  assert.match((await handleSupabaseMcp(req(b.token,'GET',`?code=fixture-code&state=${failed.searchParams.get('state')}`))).headers.get('location'), /failed/);
  assert.equal((await (await handleSupabaseMcp(req(b.token))).json()).connected, false);
  revokeAccountSessions(a.token, 'local');
  assert.equal((await handleSupabaseMcp(req())).status, 401);
});
