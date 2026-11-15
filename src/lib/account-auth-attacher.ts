import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { hasPublicConfig } from "./public-config";

export const attachAccountAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    // Local sessions travel in the HttpOnly cookie without a Supabase client.
    if (!hasPublicConfig(import.meta.env["VITE_SUPABASE_URL"], import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"])) {
      return next();
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
