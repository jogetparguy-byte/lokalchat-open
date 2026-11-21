import type { AuthChangeEvent, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { hasPublicConfig } from "./public-config";
import type { OnboardingAnswers } from "./onboarding";
import { accountIdentity, localAuthMode, setLocalAuthMode, setHostedAuthMode, setAccountIdentity } from "./account-identity";

type AccountSession = { user: User };
const EVENT = "lokalchat-account-change";
const hosted = () => hasPublicConfig(import.meta.env["VITE_SUPABASE_URL"], import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]);
let revision = 0;
async function request(body?: Record<string, unknown>, expectedAccount?: string | null) {
  const response = await fetch("/api/account", {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(expectedAccount ? { "x-lokalchat-account": expectedAccount } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as { user?: User | null; error?: string };
  if (!response.ok || result.error) throw new Error(result.error || "Sesi akaun tidak dapat disemak.");
  return result.user || null;
}
function changed(event: AuthChangeEvent, user: User | null) {
  revision++;
  setAccountIdentity(user?.id ?? null);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { event, session: user ? { user } : null } }));
  try { localStorage.setItem(EVENT, crypto.randomUUID()); } catch { /* The current tab still receives session events. */ }
}
export const accountAuth = {
  async getUser() {
    const current = revision;
    try {
      const user = await request();
      if (current !== revision) return { data: { user: null }, error: new Error("Akaun telah berubah. Cuba semula.") };
      if (user) { setLocalAuthMode(); setAccountIdentity(user.id); }
      if (!user && hosted() && !localAuthMode()) {
        const legacy = await supabase.auth.getUser();
        if (current === revision) setAccountIdentity(legacy.data.user?.id ?? null);
        return current === revision ? legacy : { data: { user: null }, error: new Error("Akaun telah berubah. Cuba semula.") };
      }
      if (!user) setAccountIdentity(null);
      return { data: { user }, error: null };
    }
    catch (error) { return { data: { user: null }, error: error as Error }; }
  },
  async getSession() {
    const { data, error } = await this.getUser();
    return { data: { session: data.user ? { user: data.user } : null }, error };
  },
  async signInWithPassword(input: { email: string; password: string }) {
    const attempt = ++revision;
    const previousOwner = accountIdentity();
    try { const user = await request({ action: "signin", ...input }); if (attempt !== revision) throw new Error("Akaun telah berubah. Cuba semula."); setLocalAuthMode(); changed("SIGNED_IN", user); if (hosted()) await supabase.auth.signOut({ scope: "local" }).catch(() => {}); return { data: { session: user ? { user } : null }, error: null }; }
    catch (error) {
      if (attempt !== revision) return { data: { session: null }, error: new Error("Akaun telah berubah. Cuba semula.") };
      if (hosted()) {
        const legacy = await supabase.auth.signInWithPassword(input);
        if (!legacy.error && legacy.data.user) {
          try {
            if (attempt !== revision) throw new Error("Akaun telah berubah. Cuba semula.");
            await request({ action: "hosted" }, previousOwner);
            if (attempt !== revision) throw new Error("Akaun telah berubah. Cuba semula.");
            setHostedAuthMode();
            changed("SIGNED_IN", legacy.data.user);
          } catch (clearError) {
            if (attempt === revision) await supabase.auth.signOut({ scope: "local" }).catch(() => {});
            return { data: { session: null }, error: clearError as Error };
          }
        }
        return legacy;
      }
      return { data: { session: null }, error: error as Error };
    }
  },
  async signUp(input: { email: string; password: string; options?: { emailRedirectTo?: string; data?: { business_name?: string; onboarding?: OnboardingAnswers } } }) {
    const attempt = ++revision;
    try { const user = await request({ action: "signup", email: input.email, password: input.password, businessName: input.options?.data?.business_name, onboarding: input.options?.data?.onboarding }); if (attempt !== revision) throw new Error("Akaun telah berubah. Cuba semula."); setLocalAuthMode(); changed("SIGNED_IN", user); if (hosted()) await supabase.auth.signOut({ scope: "local" }).catch(() => {}); return { data: { session: user ? { user } : null }, error: null }; }
    catch (error) { return { data: { session: null }, error: error as Error }; }
  },
  async updateUser(input: { data?: Record<string, unknown>; password?: string; current_password?: string; nonce?: string }) {
    const expected = accountIdentity();
    const current = revision;
    try {
      const userBefore = await request();
      if (current !== revision || userBefore && expected && userBefore.id !== expected) throw new Error("Akaun telah berubah. Cuba semula.");
      if (!userBefore && hosted() && !localAuthMode()) {
        const legacy = await supabase.auth.getUser();
        if (legacy.error || !legacy.data.user || current !== revision || expected && legacy.data.user.id !== expected) throw new Error("Akaun telah berubah. Cuba semula.");
        const updated = await supabase.auth.updateUser(input);
        if (!updated.error && updated.data.user) changed("USER_UPDATED", updated.data.user);
        return updated;
      }
      const user = await request({ action: "update", ...input }, expected ?? userBefore?.id);
      if (current !== revision) throw new Error("Akaun telah berubah. Cuba semula.");
      changed("USER_UPDATED", user); return { data: { user }, error: null };
    }
    catch (error) { return { data: { user: null }, error: error as Error }; }
  },
  async reauthenticate() {
    if (!await request() && hosted() && !localAuthMode()) return supabase.auth.reauthenticate();
    return { error: new Error("Gunakan kata laluan semasa untuk mengesahkan perubahan akaun LokalChat.") };
  },
  async signOut(input?: { scope?: "local" | "global" | "others" }) {
    const expected = accountIdentity();
    const current = revision;
    try {
      const userBefore = await request();
      if (current !== revision || userBefore && expected && userBefore.id !== expected) throw new Error("Akaun telah berubah. Cuba semula.");
      if (!userBefore && hosted() && !localAuthMode()) {
        const legacy = await supabase.auth.getUser();
        if (legacy.error || !legacy.data.user || current !== revision || expected && legacy.data.user.id !== expected) throw new Error("Akaun telah berubah. Cuba semula.");
        const result = await supabase.auth.signOut(input);
        if (!result.error && input?.scope !== "others") changed("SIGNED_OUT", null);
        return result;
      }
      const user = await request({ action: "signout", scope: input?.scope }, expected ?? userBefore?.id);
      if (input?.scope !== "others") {
        changed("SIGNED_OUT", user);
        if (hosted()) await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      }
      return { error: null };
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
    const legacy = hosted() && !localAuthMode() ? supabase.auth.onAuthStateChange((event, session) => { void request().then(user => { if (!user && !localAuthMode()) callback(event, session); }).catch(() => {}); }) : null;
    const timer = window.setInterval(sync, 60_000);
    return { data: { subscription: { unsubscribe() { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", storage); window.removeEventListener("focus", sync); window.clearInterval(timer); legacy?.data.subscription.unsubscribe(); } } } };
  },
};
