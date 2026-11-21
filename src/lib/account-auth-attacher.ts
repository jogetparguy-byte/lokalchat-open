import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { hasPublicConfig } from "./public-config";
import { accountIdentity, localAuthMode } from "./account-identity";

export const attachAccountAuth = createMiddleware({ type: "function" }).client(
  async (options) => {
    const { next } = options;
    // TanStack passes call headers at runtime; its middleware options type omits them.
    const suppliedHeaders = (options as typeof options & { headers?: HeadersInit }).headers;
    const expected = accountIdentity();
    const headers = new Headers(suppliedHeaders);
    // A mounted account's binding survives asynchronous work and cookie replacement.
    if (!headers.has("x-lokalchat-account") && expected) headers.set("x-lokalchat-account", expected);
    // Local sessions travel in the HttpOnly cookie without a Supabase client.
    if (localAuthMode() || !hasPublicConfig(import.meta.env["VITE_SUPABASE_URL"], import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"])) {
      return next({ headers });
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return next({ headers });
  },
);
