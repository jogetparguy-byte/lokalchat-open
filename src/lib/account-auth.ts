import type { AuthChangeEvent, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { hasPublicConfig } from "./public-config";

type AccountSession = { user: User };
const EVENT = "lokalchat-account-change";
const hosted = () => hasPublicConfig(import.meta.env["VITE_SUPABASE_URL"], import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]);
async function request(body?: Record<string, unknown>) {
  const response = await fetch("/api/account", {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as { user?: User | null; error?: string };
  if (!response.ok || result.error) throw new Error(result.error || "Sesi akaun tidak dapat disemak.");
  return result.user || null;
}
function changed(event: AuthChangeEvent, user: User | null) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { event, session: user ? { user } : null } }));
  try { localStorage.setItem(EVENT, crypto.randomUUID()); } catch { /* The current tab still receives session events. */ }
}
export const accountAuth = {
  async getUser() {
    try {
      const user = await request();
      if (!user && hosted()) return await supabase.auth.getUser();
      return { data: { user }, error: null };
    }
    catch (error) { return { data: { user: null }, error: error as Error }; }
  },
  async getSession() {
    const { data, error } = await this.getUser();
    return { data: { session: data.user ? { user: data.user } : null }, error };
  },
  async signInWithPassword(input: { email: string; password: string }) {
    try { const user = await request({ action: "signin", ...input }); changed("SIGNED_IN", user); return { data: { session: user ? { user } : null }, error: null }; }
    catch (error) {
      if (hosted()) return await supabase.auth.signInWithPassword(input);
      return { data: { session: null }, error: error as Error };
    }
  },
  async signUp(input: { email: string; password: string; options?: { emailRedirectTo?: string; data?: { business_name?: string } } }) {
    try { const user = await request({ action: "signup", email: input.email, password: input.password, businessName: input.options?.data?.business_name }); changed("SIGNED_IN", user); return { data: { session: user ? { user } : null }, error: null }; }
    catch (error) { return { data: { session: null }, error: error as Error }; }
  },
  async updateUser(input: { data?: Record<string, unknown>; password?: string; current_password?: string; nonce?: string }) {
    try {
      if (!await request() && hosted()) return await supabase.auth.updateUser(input);
      const user = await request({ action: "update", ...input }); changed("USER_UPDATED", user); return { data: { user }, error: null };
    }
    catch (error) { return { data: { user: null }, error: error as Error }; }
  },
  async reauthenticate() {
    if (!await request() && hosted()) return supabase.auth.reauthenticate();
    return { error: new Error("Gunakan kata laluan semasa untuk mengesahkan perubahan akaun LokalChat.") };
  },
  async signOut(input?: { scope?: "local" | "global" | "others" }) {
    try {
      if (!await request() && hosted()) return await supabase.auth.signOut(input);
      const user = await request({ action: "signout", scope: input?.scope }); if (input?.scope !== "others") changed("SIGNED_OUT", user); return { error: null };
    }
    catch (error) { return { error: error as Error }; }
  },
  onAuthStateChange(callback: (event: AuthChangeEvent, session: AccountSession | null) => void) {
    const listener = (event: Event) => { const detail = (event as CustomEvent<{ event: AuthChangeEvent; session: AccountSession | null }>).detail; callback(detail.event, detail.session); };
    const sync = () => { void this.getUser().then(({ data }) => callback(data.user ? "SIGNED_IN" : "SIGNED_OUT", data.user ? { user: data.user } : null)); };
    const storage = (event: StorageEvent) => { if (event.key === EVENT) sync(); };
    window.addEventListener(EVENT, listener);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", sync);
    const legacy = hosted() ? supabase.auth.onAuthStateChange((event, session) => { void request().then(user => { if (!user) callback(event, session); }).catch(() => {}); }) : null;
    const timer = window.setInterval(sync, 60_000);
    return { data: { subscription: { unsubscribe() { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", storage); window.removeEventListener("focus", sync); window.clearInterval(timer); legacy?.data.subscription.unsubscribe(); } } } };
  },
};
