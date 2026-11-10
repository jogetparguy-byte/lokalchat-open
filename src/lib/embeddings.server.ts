/**
 * Embedding helpers (server-only).
 *
 * Uses OpenAI `text-embedding-3-small` (1536 dims) with the owner’s saved OpenAI key.
 * When that provider is absent the app degrades gracefully: FAQ entries are stored
 * without an embedding and `search_faq` falls back to keyword matching.
 */

import { getSavedLlmConfig } from "./llm-env.server";

export async function createEmbedding(input: string, userId: string): Promise<number[] | null> {
  // Optional embeddings use this owner's OpenAI key only; other providers use keywords.
  const config = await getSavedLlmConfig(userId);
  if (!config || config.baseUrl !== "https://api.openai.com/v1") return null;
  const apiKey = config.apiKey;

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: input.slice(0, 8000),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error("Embedding request failed", { status: res.status, hasBody: errorText.length > 0 });
      return null;
    }

    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch (error) {
    console.error("Embedding request threw", { message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

