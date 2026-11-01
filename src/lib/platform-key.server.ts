/**
 * Shared platform LLM key resolution (server-only).
 *
 * The key is stored encrypted (AES-256-GCM, wa-crypto.server) in
 * public.platform_api_keys so the founder can rotate it without a redeploy.
 * If no active row exists we use the server AI_* environment variables.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "./wa-crypto.server";

export type ProviderId = "gemini" | "deepseek";

export const PROVIDERS: Record<
  ProviderId,
  { label: string; baseUrl: string; model: string; testUrl: string }
> = {
  gemini: {
    label: "Gemini",
    baseUrl: process.env["GEMINI_BASE_URL"] || "https://generativelanguage.googleapis.com/v1beta/openai",
    model: process.env["GEMINI_MODEL"] || "gemini-2.5-flash",
    testUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: process.env["DEEPSEEK_BASE_URL"] || "https://api.deepseek.com",
    model: process.env["DEEPSEEK_MODEL"] || "deepseek-chat",
    testUrl: "https://api.deepseek.com/models",
  },
};

export function isProviderId(value: string): value is ProviderId {
  return value === "gemini" || value === "deepseek";
}

/** Lightweight auth-only probe against the provider before we persist a key. */
export async function verifyProviderKey(provider: ProviderId, apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(PROVIDERS[provider].testUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Kunci API ditolak oleh penyedia (401/403)");
    }
    if (!res.ok) throw new Error(`Penyedia membalas ralat ${res.status}`);
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Penyedia tidak membalas dalam masa 10 saat");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export type LlmConfig = { baseUrl: string; model: string; apiKey: string };

export async function getActiveLlmConfig(): Promise<LlmConfig> {
  const { data } = await supabaseAdmin
    .from("platform_api_keys")
    .select("provider, api_key_encrypted")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data && isProviderId(data.provider)) {
    try {
      const meta = PROVIDERS[data.provider];
      return {
        baseUrl: meta.baseUrl,
        model: meta.model,
        apiKey: decryptSecret(data.api_key_encrypted),
      };
    } catch {
      // fall through to the server environment configuration
    }
  }

  const apiKey = process.env["AI_API_KEY"];
  const baseUrl = process.env["AI_BASE_URL"];
  const model = process.env["AI_MODEL"];
  if (!apiKey || !baseUrl || !model || [apiKey, baseUrl, model].some(v => v.includes("REPLACE_ME"))) {
    throw new Error("Configure AI_API_KEY, AI_BASE_URL and AI_MODEL on the server");
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), model };
}
