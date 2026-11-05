import { parseEnv } from "node:util";
import { envPath, readSettingsFile, updateEnvSettings } from "./env-file.server";
import { validateSupabaseSettings, type SupabaseSettingsInput } from "./supabase-settings";

function effective(saved: Record<string, string | undefined>) {
  return saved;
}
function summary(saved: Record<string, string | undefined>) {
  const env = effective(saved);
  let projectUrl = "";
  try { projectUrl = validateSupabaseSettings({ projectUrl: env["SUPABASE_URL"] || "", publicKey: "", secretKey: "" }).projectUrl; } catch { /* Unconfigured installation. */ }
  const configured = (value: string | undefined) => Boolean(value && !/REPLACE_ME/i.test(value));
  const requiresRestart = false;
  return { projectUrl, hasPublicKey: configured(env["SUPABASE_PUBLISHABLE_KEY"]), hasSecretKey: configured(env["SUPABASE_SERVICE_ROLE_KEY"]), requiresRestart };
}

export async function getSupabaseEnvSettings(userId: string) {
  try { return summary(parseEnv(await readSettingsFile(envPath(userId)))); }
  catch { throw new Error("Konfigurasi Supabase tidak dapat dibaca. Semak akses fail env pada server."); }
}

/** Save a private connection profile; never switch the installation Auth or data clients. */
export async function saveSupabaseEnvSettings(userId: string, raw: SupabaseSettingsInput) {
  const input = validateSupabaseSettings(raw);
  try {
    const next = await updateEnvSettings(userId, saved => {
      const current = effective(saved);
      const sameProject = summary(saved).projectUrl === input.projectUrl;
      if ((!input.publicKey || !input.secretKey) && !sameProject) throw new Error("NEW_KEYS_REQUIRED");
      const complete = validateSupabaseSettings({
        ...input,
        publicKey: input.publicKey || current["SUPABASE_PUBLISHABLE_KEY"] || "",
        secretKey: input.secretKey || current["SUPABASE_SERVICE_ROLE_KEY"] || "",
      });
      if (!complete.publicKey || !complete.secretKey) throw new Error("NEW_KEYS_REQUIRED");
      return {
        VITE_SUPABASE_URL: complete.projectUrl, VITE_SUPABASE_PUBLISHABLE_KEY: complete.publicKey,
        SUPABASE_URL: complete.projectUrl, SUPABASE_PUBLISHABLE_KEY: complete.publicKey,
        // Existing server clients accept both modern secret keys and legacy service_role here.
        SUPABASE_SERVICE_ROLE_KEY: complete.secretKey, SUPABASE_CONFIG_SOURCE: "settings",
      };
    });
    return summary(next);
  } catch (error) {
    if ((error as Error).message === "NEW_KEYS_REQUIRED") throw new Error("Masukkan kedua-dua API key untuk projek Supabase yang dipilih");
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Konfigurasi sedang disimpan. Cuba semula sebentar lagi.");
    throw new Error("Gagal menyimpan konfigurasi Supabase. Semak input dan akses tulis fail env pada server.");
  }
}
