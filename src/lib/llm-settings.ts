/** Providers using the OpenAI Chat Completions format consumed by the agent. */
export const LLM_PROVIDERS = {
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  custom: { label: "Provider lain (OpenAI-compatible)", baseUrl: "" },
} as const;

export type LlmProvider = keyof typeof LLM_PROVIDERS;
export type LlmSettingsInput = { provider: LlmProvider; apiKey: string; baseUrl: string; model: string };

export function validateLlmSettings(input: unknown): LlmSettingsInput {
  if (!input || typeof input !== "object") throw new Error("Konfigurasi LLM tidak sah");
  const value = input as Record<string, unknown>;
  const provider = value["provider"];
  if (typeof provider !== "string" || !Object.hasOwn(LLM_PROVIDERS, provider)) {
    throw new Error("Pilih provider LLM yang disokong");
  }
  if (typeof value["apiKey"] !== "string" || typeof value["model"] !== "string" || typeof value["baseUrl"] !== "string") {
    throw new Error("Konfigurasi LLM tidak sah");
  }
  const apiKey = value["apiKey"].trim();
  const model = value["model"].trim();
  // Restrict env values to single-line tokens; never echo submitted credentials.
  if (apiKey && (!/^[A-Za-z0-9._~+/=:@-]+$/.test(apiKey) || apiKey.length > 4096 || /REPLACE_ME/i.test(apiKey))) {
    throw new Error("Format API key tidak sah");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(model) || /REPLACE_ME/i.test(model)) {
    throw new Error("Masukkan ID model yang sah daripada provider anda");
  }
  const id = provider as LlmProvider;
  const baseUrl = (id === "custom" ? value["baseUrl"].trim() : LLM_PROVIDERS[id].baseUrl).replace(/\/+$/, "");
  try {
    const url = new URL(baseUrl);
    if (baseUrl.length > 2048 || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || /[\s'"`\\]/.test(baseUrl)) throw new Error();
  } catch {
    throw new Error("Base URL mesti alamat HTTPS tanpa credentials, query atau fragment");
  }
  return { provider: id, apiKey, baseUrl, model };
}
