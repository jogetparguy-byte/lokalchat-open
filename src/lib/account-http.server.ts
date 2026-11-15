import { authenticateAccount, readAccount, revokeAccountSessions, updateAccount } from "./account-store.server";

export const ACCOUNT_COOKIE = "lokalchat_session";
export function accountToken(request: Request) {
  return request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(ACCOUNT_COOKIE + "="))?.slice(ACCOUNT_COOKIE.length + 1);
}

export async function handleAccountRequest(request: Request) {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Cookie" });
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  const token = accountToken(request);
  if (request.method === "GET") return respond({ user: readAccount(token) });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return respond({ error: "Permintaan tidak dibenarkan." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 16000) return respond({ error: "Permintaan terlalu besar." }, 413);
  try {
    const text = await request.text();
    if (text.length > 16000) return respond({ error: "Permintaan terlalu besar." }, 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "Permintaan tidak sah." }, 400);
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    const cookie = (value: string, maxAge: number) => headers.append("Set-Cookie", `${ACCOUNT_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
    if (body.action === "signup" || body.action === "signin") {
      const result = await authenticateAccount(body, body.action === "signup", token);
      cookie(result.token, result.maxAge);
      return respond({ user: result.user });
    }
    const user = readAccount(token);
    if (!user || !token) return respond({ error: "Sila log masuk semula." }, 401);
    if (body.action === "signout") {
      const scope = body.scope === "global" || body.scope === "others" ? body.scope : "local";
      revokeAccountSessions(token, scope);
      if (scope !== "others") cookie("", 0);
      return respond({ user: scope === "others" ? user : null });
    }
    if (body.action === "update") return respond({ user: await updateAccount(token, body) });
    return respond({ error: "Permintaan tidak sah." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Permintaan gagal.";
    // Never return filesystem paths, SQL details or internal failures.
    const safe = /^(Masukkan|Kata laluan|Emel atau|Pendaftaran|Terlalu banyak|Sila log|Maklumat akaun)/.test(message);
    return respond({ error: safe ? message : "Permintaan gagal. Cuba semula." }, safe && message.startsWith("Terlalu banyak") ? 429 : 400);
  }
}
