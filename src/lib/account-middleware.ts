import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { User } from "@supabase/supabase-js";

export const requireAccountAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { accountToken } = await import("./account-http.server");
  const { readAccount } = await import("./account-store.server");
  const request = getRequest();
  const localToken = accountToken(request);
  const account = readAccount(localToken);
  const expected = request.headers.get("x-lokalchat-account");
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (localToken !== undefined && !account) throw new Error("Unauthorized: Sila log masuk semula.");
  if (account) {
    if (expected && expected !== account.id) throw new Error("Unauthorized: Akaun telah berubah. Muat semula halaman.");
    return next({ context: { userId: account.id, account: account as User | null, supabase: undefined as ReturnType<typeof createClient<Database>> | undefined } });
  }
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token || !url || !key) throw new Error("Unauthorized: Sila log masuk semula.");
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new Error("Unauthorized: Sila log masuk semula.");
  if (expected && expected !== data.claims.sub) throw new Error("Unauthorized: Akaun telah berubah. Muat semula halaman.");
  return next({ context: { userId: data.claims.sub, account: null as User | null, supabase: supabase as ReturnType<typeof createClient<Database>> | undefined } });
});
