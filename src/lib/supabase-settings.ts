export type SupabaseSettingsInput = { projectUrl: string; publicKey: string; secretKey: string };

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Konfigurasi Supabase tidak sah");
  return value.trim();
}

/** Format check only. Never treat decoded, unverified JWT claims as authorization. */
function legacyRole(key: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return;
  try {
    const payload = key.split(".")[1]!;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).role;
  } catch { return; }
}

export function validateSupabaseSettings(raw: unknown): SupabaseSettingsInput {
  if (!raw || typeof raw !== "object") throw new Error("Konfigurasi Supabase tidak sah");
  const input = raw as Record<string, unknown>;
  const projectUrl = text(input["projectUrl"]);
  const publicKey = text(input["publicKey"]);
  const secretKey = text(input["secretKey"]);
  let url: URL;
  try {
    url = new URL(projectUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (projectUrl.length > 2048 || /[\s'"`\\]/.test(projectUrl) || /REPLACE_ME/i.test(projectUrl)
      || !(url.protocol === "https:" || url.protocol === "http:" && local)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
  } catch { throw new Error("Gunakan URL projek HTTPS atau HTTP localhost, tanpa path, query atau credentials"); }
  for (const key of [publicKey, secretKey]) {
    if (key && (key.length > 4096 || !/^[A-Za-z0-9._~-]+$/.test(key) || /REPLACE_ME/i.test(key))) {
      throw new Error("Format API key Supabase tidak sah");
    }
  }
  if (publicKey && !(/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey) || legacyRole(publicKey) === "anon")) {
    throw new Error("Publishable key mesti sb_publishable_ atau legacy anon; jangan gunakan secret key");
  }
  if (secretKey && !(/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey) || legacyRole(secretKey) === "service_role")) {
    throw new Error("Secret key mesti sb_secret_ atau legacy service_role");
  }
  return { projectUrl: url.origin, publicKey, secretKey };
}
