import { parseEnv } from "node:util";
import { envPath, readSettingsFile, updateEnvSettings } from "./env-file.server";
import { LLM_PROVIDERS, validateLlmSettings, type LlmProvider, type LlmSettingsInput } from "./llm-settings";

const SAVE_ERROR = "Gagal menyimpan konfigurasi LLM. Pastikan fail env boleh ditulis oleh server dan cuba semula.";
const READ_ERROR = "Konfigurasi LLM tidak dapat dibaca. Semak akses fail env pada server.";

function configured(value: string | undefined): value is string {
  return Boolean(value?.trim() && !/REPLACE_ME/i.test(value));
}

function summary(env: Record<string, string | undefined>) {
  const baseUrl = env["AI_BASE_URL"] || "";
  const provider = Object.entries(LLM_PROVIDERS).find(([id, config]) => id !== "custom" && config.baseUrl === baseUrl.replace(/\/+$/, ""))?.[0] as LlmProvider | undefined;
  return {
    provider: provider || (configured(baseUrl) ? "custom" : "gemini") as LlmProvider,
    baseUrl: configured(baseUrl) ? baseUrl : "",
    model: configured(env["AI_MODEL"]) ? env["AI_MODEL"]! : "",
    hasApiKey: configured(env["AI_API_KEY"]),
    active: env["AI_CONFIG_SOURCE"] === "env" && configured(env["AI_API_KEY"]) && configured(baseUrl) && configured(env["AI_MODEL"]),
  };
}

export async function getLlmEnvSettings(userId: string) {
  try {
    const file = parseEnv(await readSettingsFile(envPath(userId)));
    // Once saved here, the persisted file is authoritative across server workers.
    return summary(file);
  } catch { throw new Error(READ_ERROR); }
}

/** Reads the complete saved config together on every request, without restarting. */
export async function getSavedLlmConfig(userId: string) {
  try {
    const env = parseEnv(await readSettingsFile(envPath(userId)));
    if (env["AI_CONFIG_SOURCE"] !== "env") return null;
    const input = validateLlmSettings({ provider: env["AI_PROVIDER"] || "custom", apiKey: env["AI_API_KEY"] || "", baseUrl: env["AI_BASE_URL"] || "", model: env["AI_MODEL"] || "" });
    if (!input.apiKey) throw new Error();
    return { baseUrl: input.baseUrl, model: input.model, apiKey: input.apiKey };
  } catch { throw new Error(READ_ERROR); }
}

export async function saveLlmEnvSettings(userId: string, raw: LlmSettingsInput) {
  const input = validateLlmSettings(raw);
  try {
    const savedEnv = await updateEnvSettings(userId, (saved) => {
      if (!input.apiKey) {
        // A retained key must never be sent to a newly selected provider or endpoint.
        const current = summary(saved);
        if (current.provider !== input.provider || current.baseUrl.replace(/\/+$/, "") !== input.baseUrl) {
          throw new Error("NEW_KEY_REQUIRED");
        }
        input.apiKey = saved["AI_API_KEY"] || "";
        if (!configured(input.apiKey)) throw new Error("NEW_KEY_REQUIRED");
        validateLlmSettings(input);
      }
      return {
        AI_PROVIDER: input.provider, AI_API_KEY: input.apiKey, AI_BASE_URL: input.baseUrl,
        AI_MODEL: input.model, AI_CONFIG_SOURCE: "env",
      };
    });
    return summary(savedEnv);
  } catch (error) {
    if ((error as Error).message === "NEW_KEY_REQUIRED") throw new Error("Masukkan API key untuk provider dan Base URL yang dipilih");
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Konfigurasi LLM sedang disimpan. Cuba semula sebentar lagi.");
    throw new Error(SAVE_ERROR);
  }
}
