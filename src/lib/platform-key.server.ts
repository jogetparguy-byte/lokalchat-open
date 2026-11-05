/**
 * Per-owner LLM key resolution (server-only).
 *
 * Credentials come exclusively from the verified owner's private env file.
 * Legacy platform keys and process AI_* variables never fund tenant requests.
 */
import { getSavedLlmConfig } from "./llm-env.server";

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

export async function getActiveLlmConfig(userId: string): Promise<LlmConfig> {
  // An explicit selection in Settings takes precedence over the legacy admin DB key.
  // Shared keys are intentionally excluded, including when this owner has no config.
  const saved = await getSavedLlmConfig(userId);
  if (!saved) throw new Error("Sediakan konfigurasi Provider AI untuk akaun anda dalam Tetapan");
  return saved;
}
