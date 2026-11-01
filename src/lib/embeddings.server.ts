/**
 * Embedding helpers (server-only).
 *
 * Uses OpenAI `text-embedding-3-small` (1536 dims) when OPENAI_API_KEY is set.
 * When the key is absent the app degrades gracefully: FAQ entries are stored
 * without an embedding and `search_faq` falls back to keyword matching.
 */

export function hasEmbeddingProvider(): boolean {
  return Boolean(process.env["OPENAI_API_KEY"]);
}

export async function createEmbedding(input: string): Promise<number[] | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;

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
    });

    if (!res.ok) {
      console.error("Embedding request failed", res.status, await res.text());
      return null;
    }

    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch (error) {
    console.error("Embedding request threw", error);
    return null;
  }
}

