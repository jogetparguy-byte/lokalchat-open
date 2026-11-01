/**
 * Unanswered-question capture (server-only).
 *
 * Called by the agent when it cannot answer from the FAQ. Groups semantically
 * similar questions within ONE business: cosine similarity on embeddings when
 * available, otherwise token-overlap (Jaccard) on normalised keywords.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createEmbedding } from "./embeddings.server";

const STOPWORDS = new Set(
  "ada boleh tak ke ka x ni tu ini itu sis boss bro bos kak abang dik saya aku nak mahu mau apa ya yer ye la lah kah pun dan atau yang di dengan untuk utk ke kat dekat ok okay please pls hi hello helo salam the a an is are do does can you i we any is there".split(
    " ",
  ),
);

export function normalizeTokens(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(tokens)].slice(0, 30);
}

function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const inter = a.filter((t) => sb.has(t)).length;
  return inter / (a.length + b.length - inter);
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function parseVector(v: unknown): number[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v as number[];
  try {
    return JSON.parse(String(v)) as number[];
  } catch {
    return null;
  }
}

export async function recordUnansweredQuestion(params: {
  businessId: string;
  chatId: string;
  question: string;
}): Promise<void> {
  const question = params.question.trim().slice(0, 1000);
  if (!question) return;
  const { businessId, chatId } = params;

  try {
    const tokens = normalizeTokens(question);
    const embedding = await createEmbedding(question);

    const { data: candidates } = await supabaseAdmin
      .from("unanswered_questions")
      .select("id, normalized_tokens, embedding, status, occurrence_count, failed_after_faq_count")
      .eq("business_id", businessId)
      .order("last_asked_at", { ascending: false })
      .limit(300);

    let best: (NonNullable<typeof candidates>[number]) | null = null;
    let bestScore = 0;
    for (const c of candidates ?? []) {
      const vec = parseVector(c.embedding);
      const score =
        embedding && vec ? (cosine(embedding, vec) >= 0.85 ? 1 : 0) : jaccard(tokens, c.normalized_tokens ?? []);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    const match = best && bestScore >= 0.5 ? best : null;

    const { data: chat } = await supabaseAdmin
      .from("chats")
      .select("customer_phone, customer_name")
      .eq("id", chatId)
      .eq("business_id", businessId)
      .maybeSingle();

    const now = new Date().toISOString();
    let questionId: string;
    let failedAfterFaq = false;

    if (match) {
      questionId = match.id;
      failedAfterFaq = match.status === "resolved";
      await supabaseAdmin
        .from("unanswered_questions")
        .update({
          occurrence_count: match.occurrence_count + 1,
          last_asked_at: now,
          ...(failedAfterFaq
            ? {
                status: "unanswered",
                resolved_at: null,
                failed_after_faq_count: match.failed_after_faq_count + 1,
                last_failed_after_faq_at: now,
              }
            : {}),
        })
        .eq("id", match.id)
        .eq("business_id", businessId);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("unanswered_questions")
        .insert({
          business_id: businessId,
          question,
          normalized_tokens: tokens,
          embedding: embedding ? (JSON.stringify(embedding) as unknown as string) : null,
        })
        .select("id")
        .single();
      if (error || !inserted) throw new Error(error?.message ?? "insert failed");
      questionId = inserted.id;
    }

    await supabaseAdmin.from("unanswered_question_occurrences").insert({
      question_id: questionId,
      business_id: businessId,
      chat_id: chatId,
      question_text: question,
      customer_phone: chat?.customer_phone ?? null,
      customer_name: chat?.customer_name ?? null,
      failed_after_faq: failedAfterFaq,
    });
  } catch (error) {
    console.error("recordUnansweredQuestion failed", error);
  }
}

