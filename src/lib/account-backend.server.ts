import { createHash, randomBytes } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { accountToken } from "./account-http.server";
import { accountInstallationId, accountProfile, readAccount } from "./account-store.server";
import { hasPublicConfig } from "./public-config";

const ERROR = "Sambungan data belum tersedia. Semak konfigurasi backend Supabase pemasangan ini.";
const BINDING_ERROR = "Identiti backend tidak sepadan dengan akaun LokalChat ini.";
const sessions = new Map<string, { token: string; expires: number }>();
const synchronizing = new Map<string, Promise<void>>();

function config() {
  const url = process.env["SUPABASE_URL"]?.replace(/\/+$/, "");
  const publicKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const secretKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!hasPublicConfig(url, publicKey) || !secretKey || /replace_me/i.test(secretKey)) throw new Error(ERROR);
  return { url: url!, publicKey: publicKey!, secretKey };
}

export function hasAccountBackendConfig() {
  try { config(); return true; } catch { return false; }
}

function client(url: string, key: string, token?: string) {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers, signal: AbortSignal.timeout(20000), redirect: "error" });
      },
    },
  });
}

function assertSession(request: Request, token: string, expectedId: string) {
  if (readAccount(token)?.id !== expectedId) throw new Error("Unauthorized: Sila log masuk semula.");
  const expected = request.headers.get("x-lokalchat-account");
  if (expected && expected !== expectedId) throw new Error("Unauthorized: Akaun telah berubah. Muat semula halaman.");
}

function verifyBinding(user: User, account: User, installationId: string, email: string) {
  if (user.id !== account.id || user.email !== email || user.app_metadata["lokalchat_installation_id"] !== installationId || user.app_metadata["lokalchat_account_id"] !== account.id) {
    throw new Error(BINDING_ERROR);
  }
}

async function ensureUser(admin: ReturnType<typeof client>, account: User, installationId: string, email: string) {
  let { data: { user }, error } = await admin.auth.admin.getUserById(account.id);
  if (error && error.status !== 404 && error.code !== "user_not_found") throw new Error(ERROR);
  if (!user) {
    const created = await admin.auth.admin.createUser({
      id: account.id, email, email_confirm: true,
      password: randomBytes(48).toString("base64url"),
      app_metadata: { lokalchat_installation_id: installationId, lokalchat_account_id: account.id },
      user_metadata: account.user_metadata,
    });
    if (created.error) {
      // Another request may have created the same identity. Never adopt an unrelated UUID or email.
      const existing = await admin.auth.admin.getUserById(account.id);
      if (existing.error || !existing.data.user) throw new Error(BINDING_ERROR);
      user = existing.data.user;
    } else user = created.data.user;
  }
  if (!user) throw new Error(ERROR);
  verifyBinding(user, account, installationId, email);
  if (JSON.stringify(user.user_metadata) !== JSON.stringify(account.user_metadata)) {
    const updated = await admin.auth.admin.updateUserById(account.id, { user_metadata: account.user_metadata });
    if (updated.error || !updated.data.user) throw new Error(ERROR);
    verifyBinding(updated.data.user, account, installationId, email);
  }
}

async function exchangeSession(admin: ReturnType<typeof client>, url: string, publicKey: string, account: User, installationId: string, email: string) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.user || !link.data.properties?.hashed_token) throw new Error(ERROR);
  verifyBinding(link.data.user, account, installationId, email);
  const verifier = client(url, publicKey);
  const verified = await verifier.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  const session = verified.data.session;
  if (verified.error || !session || !verified.data.user) throw new Error(ERROR);
  verifyBinding(verified.data.user, account, installationId, email);
  const saved = { token: session.access_token, expires: (session.expires_at ?? 0) * 1000 - 60000 };
  if (saved.expires <= Date.now()) throw new Error(ERROR);
  return saved;
}

/** Exchanges a verified local session for a server-only, RLS-enforced backend identity. */
export async function localBackendContext(request: Request) {
  const token = accountToken(request);
  const account = readAccount(token);
  if (!token || !account) throw new Error("Unauthorized: Sila log masuk semula.");
  assertSession(request, token, account.id);
  const { url, publicKey, secretKey } = config();
  const installationId = accountInstallationId();
  const email = `local-${account.id}@${installationId}.lokalchat.invalid`;
  const project = createHash("sha256").update(`${url}\0${secretKey}\0${installationId}`).digest("hex");
  const identity = `${project}:${account.id}`;
  const sessionKey = createHash("sha256").update(`${identity}\0${token}`).digest("hex");
  // Serialize mirroring too: an older request must not overwrite settings saved by a newer request.
  const previous = synchronizing.get(identity) ?? Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    assertSession(request, token, account.id);
    const current = readAccount(token)!;
    const admin = client(url, secretKey);
    await ensureUser(admin, current, installationId, email);
    assertSession(request, token, account.id);
    for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
    let saved = sessions.get(sessionKey);
    if (!saved) {
      saved = await exchangeSession(admin, url, publicKey, current, installationId, email);
      if (sessions.size >= 200) sessions.delete(sessions.keys().next().value!);
      sessions.set(sessionKey, saved);
    }
    assertSession(request, token, account.id);
    // A fresh scoped client per request prevents shared mutable auth state across accounts.
    const supabase = client(url, publicKey, saved.token);
    const profile = accountProfile(account.id);
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: account.id, business_name: profile.business_name,
      inventory_api_url: profile.inventory_api_url, owner_whatsapp: profile.owner_whatsapp,
    }, { onConflict: "id" });
    if (profileError) throw new Error(ERROR);
    assertSession(request, token, account.id);
    return { supabase, userId: account.id, account: current, claims: { sub: account.id, role: "authenticated", session_id: sessionKey } };
  });
  const barrier = work.then(() => {}, () => {});
  synchronizing.set(identity, barrier);
  try { return await work; } finally { if (synchronizing.get(identity) === barrier) synchronizing.delete(identity); }
}
