import { createHash, randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { envPath, readSettingsFile, updateEnvSettings } from "./env-file.server";
import { accountToken } from "./account-http.server";
import { readAccount } from "./account-store.server";

const ISSUER = "https://api.supabase.com";
const RESOURCE = "https://mcp.supabase.com/mcp";
const CALLBACK = "/api/supabase/mcp";
const CONNECTION = "SUPABASE_MCP_CONNECTION";
const PENDING = "SUPABASE_MCP_PENDING";
type Client = { client_id: string; client_secret: string; token_endpoint_auth_method?: string; redirect_uri: string };
type Pending = { state: string; verifier: string; session: string; expires: number; client: Client };
type Connection = { client: Client; access_token: string; refresh_token?: string; expires: number };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function decode<T>(value?: string): T | null {
  return value ? JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T : null;
}
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
async function saved(userId: string) { return parseEnv(await readSettingsFile(envPath(userId))); }

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Supabase request failed");
  return response.json();
}

async function register(redirectUri: string): Promise<Client> {
  const metadata = await jsonRequest(`${ISSUER}/.well-known/oauth-authorization-server`);
  // Pin the issuer and endpoints: discovery cannot redirect credentials elsewhere.
  if (metadata.issuer !== ISSUER || metadata.authorization_endpoint !== `${ISSUER}/v1/oauth/authorize` || metadata.token_endpoint !== `${ISSUER}/v1/oauth/token` || metadata.registration_endpoint !== `${ISSUER}/platform/oauth/apps/register`) throw new Error("Invalid issuer");
  const client = await jsonRequest(metadata.registration_endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "LokalChat MCP Connector", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "client_secret_basic" }),
  });
  if (typeof client.client_id !== "string" || typeof client.client_secret !== "string") throw new Error("Invalid registration");
  return { client_id: client.client_id, client_secret: client.client_secret, token_endpoint_auth_method: client.token_endpoint_auth_method, redirect_uri: redirectUri };
}

async function exchange(client: Client, parameters: Record<string, string>): Promise<Connection> {
  const body = new URLSearchParams(parameters);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (client.token_endpoint_auth_method === "client_secret_post") {
    body.set("client_id", client.client_id); body.set("client_secret", client.client_secret);
  } else {
    headers["Authorization"] = `Basic ${Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`).toString("base64")}`;
  }
  const tokens = await jsonRequest(`${ISSUER}/v1/oauth/token`, { method: "POST", headers, body });
  if (typeof tokens.access_token !== "string" || tokens.token_type?.toLowerCase() !== "bearer" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error("Invalid token");
  return { client, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires: Date.now() + tokens.expires_in * 1000 };
}

async function verifyMcp(accessToken: string) {
  const response = await fetch(RESOURCE, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lokalchat", version: "1.0.0" } } }),
  });
  if (!response.ok) throw new Error("MCP unavailable");
  // Streamable HTTP may return either JSON or one SSE response. Cancel after initialize.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing MCP response");
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < 100000) {
      const { value, done } = await reader.read();
      text += decoder.decode(value, { stream: !done });
      const candidates = response.headers.get("content-type")?.includes("text/event-stream")
        ? text.split(/\r?\n\r?\n/).slice(0, -1).map(event => event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n")) : [text];
      for (const candidate of candidates) {
        let message;
        try { message = JSON.parse(candidate); } catch { continue; }
        if (message.id === 1 && message.result?.serverInfo && message.result?.protocolVersion) return;
        if (message.error) throw new Error("MCP initialization failed");
      }
      if (done) break;
    }
    throw new Error("Invalid MCP response");
  } finally { await reader.cancel().catch(() => {}); }
}

export async function handleSupabaseMcp(request: Request) {
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie" };
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
  const redirect = (result: string) => new Response(null, { status: 303, headers: { ...headers, Location: `/dashboard/settings?supabase_mcp=${result}#supabase` } });
  const token = accountToken(request);
  const user = readAccount(token);
  if (!user || !token) return json({ error: "Sila log masuk semula." }, 401);
  const callback = url.searchParams.has("code") || url.searchParams.has("error") || url.searchParams.has("state");
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.method === "POST" && (request.headers.get("origin") !== url.origin || !request.headers.get("content-type")?.startsWith("application/json"))) return json({ error: "Permintaan tidak dibenarkan." }, 403);
  try {
    if (request.method === "GET" && callback) {
      let pending: Pending | null = null;
      await updateEnvSettings(user.id, values => {
        const value = decode<Pending>(values[PENDING]);
        if (!value || value.state !== url.searchParams.get("state") || value.session !== hash(token) || value.expires < Date.now() || value.client.redirect_uri !== `${url.origin}${CALLBACK}`) throw new Error("Invalid state");
        pending = value;
        return { [PENDING]: "" };
      });
      const flow = pending as Pending | null;
      if (!flow) throw new Error("Missing flow");
      if (url.searchParams.has("error")) return redirect("cancelled");
      const code = url.searchParams.get("code");
      if (!code || code.length > 8192 || url.searchParams.has("iss") && url.searchParams.get("iss") !== ISSUER) throw new Error("Invalid callback");
      const connection = await exchange(flow.client, { grant_type: "authorization_code", code, redirect_uri: flow.client.redirect_uri, code_verifier: flow.verifier });
      await verifyMcp(connection.access_token);
      // Recheck the login after network work; logout must prevent a late callback save.
      if (readAccount(token)?.id !== user.id) throw new Error("Session ended");
      await updateEnvSettings(user.id, () => ({ [CONNECTION]: encode(connection) }));
      return redirect("connected");
    }
    if (request.method === "GET") {
      let connection = decode<Connection>((await saved(user.id))[CONNECTION]);
      if (connection && connection.expires <= Date.now() + 60000 && connection.refresh_token) {
        try {
          const refreshed = await exchange(connection.client, { grant_type: "refresh_token", refresh_token: connection.refresh_token });
          refreshed.refresh_token ||= connection.refresh_token;
          await verifyMcp(refreshed.access_token);
          if (readAccount(token)?.id !== user.id) throw new Error("Session ended");
          await updateEnvSettings(user.id, () => ({ [CONNECTION]: encode(refreshed) }));
          connection = refreshed;
        } catch { return json({ connected: false, needsReconnect: true }); }
      }
      return json({ connected: Boolean(connection && connection.expires > Date.now()), needsReconnect: Boolean(connection && connection.expires <= Date.now()) });
    }
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return json({ error: "OAuth memerlukan HTTPS atau localhost." }, 400);
    const previous = await saved(user.id);
    const existing = decode<Pending>(previous[PENDING]);
    if (existing && existing.expires > Date.now() + 9.5 * 60000) return json({ error: "Sila tunggu sebentar sebelum cuba semula." }, 429);
    const redirectUri = `${url.origin}${CALLBACK}`;
    const connection = decode<Connection>(previous[CONNECTION]);
    const client = connection?.client.redirect_uri === redirectUri ? connection.client : existing?.client.redirect_uri === redirectUri ? existing.client : await register(redirectUri);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    await updateEnvSettings(user.id, () => ({ [PENDING]: encode({ state, verifier, session: hash(token), expires: Date.now() + 10 * 60000, client } satisfies Pending) }));
    const authorize = new URL(`${ISSUER}/v1/oauth/authorize`);
    authorize.search = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, state, code_challenge: hash(verifier), code_challenge_method: "S256", resource: RESOURCE }).toString();
    return json({ authorizationUrl: authorize.href });
  } catch {
    if (callback) return redirect("failed");
    return json({ error: "Sambungan Supabase gagal. Cuba semula." }, 502);
  }
}
