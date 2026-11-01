/**
 * LokalChat AI agent orchestration (server-only).
 *
 * Runs a tool-calling loop against a configured OpenAI-compatible provider
 * with three tools: search_faq (pgvector RAG), check_stock (live inventory
 * HTTP fetch) and trigger_human_handoff (pauses the bot for this chat).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createEmbedding } from "./embeddings.server";
import { sendWhatsAppMessage } from "./whatsapp.server";

const HANDOFF_REPLY = "Maaf ya, saya sambungkan kepada pemilik kedai sekarang.";

export const SYSTEM_PROMPT = `Anda adalah AI customer service bernama LokalChat untuk kedai PKS Malaysia. Anda wajib faham Bahasa Melayu Pasar, English, dan Manglish (cth: 'ada stock tak?', 'pm harga boss', 'bila pos?'). Jawab dengan mesra (boleh guna sis/boss/bro). Gunakan fungsi 'search_faq' untuk mencari jawapan dan 'check_stock' untuk semak inventori. Jika soalan tiada dalam FAQ, atau pelanggan mahu bercakap dengan manusia, panggil fungsi 'trigger_human_handoff' segera (reason='no_answer' jika anda tidak pasti jawapannya, reason='customer_request' jika pelanggan minta manusia). Jangan reka jawapan yang tiada dalam FAQ.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_faq",
      description:
        "Cari jawapan dalam knowledge base / FAQ kedai menggunakan carian semantik.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Soalan pelanggan" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_stock",
      description: "Semak stok terkini sesuatu produk dari sistem inventori kedai.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Nama produk" },
        },
        required: ["product_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_human_handoff",
      description:
        "Serahkan perbualan kepada pemilik kedai (manusia) dan matikan bot untuk chat ini.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            enum: ["no_answer", "customer_request"],
            description:
              "'no_answer' jika jawapan tiada dalam FAQ / tidak pasti; 'customer_request' jika pelanggan minta manusia.",
          },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
] as const;

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

/* ------------------------------- tools ---------------------------------- */

async function searchFaq(query: string, businessId: string | null): Promise<string> {
  if (!businessId) return "TIADA_JAWAPAN_DALAM_FAQ";
  const embedding = await createEmbedding(query);

  if (embedding) {
    const { data, error } = await supabaseAdmin.rpc("match_documents", {
      query_embedding: embedding as unknown as string,
      business_id: businessId,
      match_threshold: 0.3,
      match_count: 3,
    });
    if (error) console.error("match_documents failed", error);
    if (data && data.length > 0) {
      return data.map((row) => `- ${row.content}`).join("\n");
    }
  }

  // Fallback: keyword search when no embedding provider is configured.
  const keyword = query.split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? query;
  const { data } = await supabaseAdmin
    .from("knowledge_base")
    .select("content")
    .eq("business_id", businessId)
    .ilike("content", `%${keyword}%`)
    .limit(3);

  if (!data || data.length === 0) return "TIADA_JAWAPAN_DALAM_FAQ";
  return data.map((row) => `- ${row.content}`).join("\n");
}

async function checkStock(productName: string, businessId: string | null): Promise<string> {
  if (!businessId) return "Sistem inventori belum disambungkan oleh pemilik kedai.";
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("inventory_api_url")
    .eq("id", businessId)
    .maybeSingle();

  const baseUrl = profile?.inventory_api_url;
  if (!baseUrl) return "Sistem inventori belum disambungkan oleh pemilik kedai.";


  try {
    const { assertPublicHttpUrl } = await import("./ssrf.server");
    const url = await assertPublicHttpUrl(baseUrl);
    url.searchParams.set("product", productName);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return `Gagal semak stok (status ${res.status}).`;
    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > 64 * 1024) return "Respons inventori terlalu besar.";
    const body = await res.text();
    return body.slice(0, 1500);
  } catch (error) {
    console.error("check_stock failed", error);
    return "Sistem inventori tidak dapat dihubungi buat masa ini.";
  }
}

async function triggerHumanHandoff(chatId: string): Promise<string> {
  const { error } = await supabaseAdmin
    .from("chats")
    .update({ is_bot_active: false })
    .eq("id", chatId);
  if (error) throw new Error(`handoff update failed: ${error.message}`);

  await supabaseAdmin.from("messages").insert({
    chat_id: chatId,
    sender: "system",
    text: "⚠️ Bot dimatikan — perbualan diserahkan kepada pemilik kedai.",
  });

  return HANDOFF_REPLY;
}

/* ------------------------------- runner --------------------------------- */

async function loadHistory(chatId: string): Promise<ChatMessage[]> {
  const { data } = await supabaseAdmin
    .from("messages")
    .select("sender, text")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(16);

  return (data ?? [])
    .reverse()
    .filter((m) => m.sender !== "system")
    .map((m) => ({
      role: m.sender === "customer" ? ("user" as const) : ("assistant" as const),
      content: m.text,
    }));
}

async function callGateway(messages: ChatMessage[]) {
  const { getActiveLlmConfig } = await import("./platform-key.server");
  const { baseUrl, model, apiKey } = await getActiveLlmConfig();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: TOOLS,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("NO_CREDITS");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);

  return (await res.json()) as {
    choices: Array<{ message: ChatMessage }>;
  };
}

export type AgentResult = {
  reply: string;
  handedOff: boolean;
  /** Persisted bot message id; delivery is handled by the caller. */
  botMessageId: string;
};

/**
 * Runs the agent for the latest customer message on a chat, persists the bot
 * reply and pushes it back over WhatsApp.
 */
export async function runAgent(params: {
  chatId: string;
  customerPhone: string;
  userMessage: string;
  /** WhatsApp message.id, used to link the bot reply for crash-safe dedup. */
  messageId?: string;
}): Promise<AgentResult> {
  const { chatId, customerPhone, userMessage, messageId } = params;

  const { data: chatRow } = await supabaseAdmin
    .from("chats")
    .select("business_id")
    .eq("id", chatId)
    .maybeSingle();
  const businessId = chatRow?.business_id ?? null;

  const history = await loadHistory(chatId);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];
  if (history.at(-1)?.content !== userMessage) {
    messages.push({ role: "user", content: userMessage });
  }

  let handedOff = false;
  let reply = "";

  try {
    for (let step = 0; step < 4; step += 1) {
      const completion = await callGateway(messages);
      const choice = completion.choices?.[0]?.message;
      if (!choice) break;

      messages.push(choice);

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        reply = (choice.content ?? "").trim();
        break;
      }

      for (const call of toolCalls) {
        let args: Record<string, string> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        let result: string;
        switch (call.function.name) {
          case "search_faq":
            result = await searchFaq(args["query"] ?? userMessage, businessId);
            break;
          case "check_stock":
            result = await checkStock(args["product_name"] ?? "", businessId);

            break;
          case "trigger_human_handoff":
            result = await triggerHumanHandoff(chatId);
            handedOff = true;
            if (args["reason"] !== "customer_request" && businessId) {
              const { recordUnansweredQuestion } = await import("./unanswered.server");
              await recordUnansweredQuestion({ businessId, chatId, question: userMessage });
            }
            break;
          default:
            result = "Fungsi tidak dikenali.";
        }

        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }

      if (handedOff) {
        reply = HANDOFF_REPLY;
        break;
      }
    }
  } catch (error) {
    console.error("Agent run failed", error);
    reply =
      "Maaf boss, sistem saya ada gangguan sekejap. Saya panggil pemilik kedai ya.";
    if (!handedOff) {
      await triggerHumanHandoff(chatId);
      handedOff = true;
    }
  }

  if (!reply) reply = HANDOFF_REPLY;

  const { data: botMessage, error: botInsertError } = await supabaseAdmin
    .from("messages")
    .insert({
      chat_id: chatId,
      sender: "bot",
      text: reply,
      delivery_status: "pending",
      ...(messageId ? { reply_to_external_message_id: messageId } : {}),
    })
    .select("id")
    .single();
  if (botInsertError || !botMessage) {
    // Do not send a reply that was not persisted: the caller marks the inbound
    // message as failed so a later webhook retry can regenerate it.
    throw new Error(
      `Failed to save bot reply: ${botInsertError?.message ?? "no row returned"}`,
    );
  }
  await supabaseAdmin
    .from("chats")
    .update({ last_message: reply, updated_at: new Date().toISOString() })
    .eq("id", chatId);

  return { reply, handedOff, botMessageId: botMessage.id };
}

/**
 * Shared ingest path used by both the WhatsApp webhook and the dashboard
 * simulator: upsert chat, log the customer message, then run the bot when it
 * is active for that chat.
 */
async function claimInboundMessage(chatId: string, messageId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("claim_inbound_message", {
    p_chat_id: chatId,
    p_external_message_id: messageId,
  });
  if (error) throw new Error(`Failed to claim inbound message: ${error.message}`);
  return data === true;
}

async function finishInboundMessage(
  chatId: string,
  messageId: string,
  status: "done" | "failed",
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("finish_inbound_message", {
    p_chat_id: chatId,
    p_external_message_id: messageId,
    p_status: status,
  });
  if (error) console.error("Failed to finalize inbound message", error);
}

type LinkedReply = {
  id: string;
  text: string;
  deliveryStatus: string | null;
};

/** Finds the single bot reply linked to an inbound message, if it exists. */
async function findLinkedReply(
  chatId: string,
  messageId: string,
): Promise<LinkedReply | null> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id, text, delivery_status")
    .eq("chat_id", chatId)
    .eq("reply_to_external_message_id", messageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    text: data.text,
    deliveryStatus: data.delivery_status,
  };
}

async function claimOutboundMessage(messageId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("claim_outbound_message", {
    p_message_id: messageId,
  });
  if (error) throw new Error(`Failed to claim outbound message: ${error.message}`);
  return data === true;
}

async function finishOutboundMessage(
  messageId: string,
  status: "sent" | "failed",
  errorMessage?: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("finish_outbound_message", {
    p_message_id: messageId,
    p_status: status,
    p_error: errorMessage ?? null,
  });
  if (error) console.error("Failed to finalize outbound message", error);
}

/** Submits an already-persisted bot reply, retrying safely on later requests. */
async function deliverBotReply(
  reply: LinkedReply,
  customerPhone: string,
  businessId: string,
  allowDryRun: boolean,
): Promise<"sent" | "in_progress" | "failed"> {
  const claimed = await claimOutboundMessage(reply.id);
  if (!claimed) return "in_progress";

  let result: Awaited<ReturnType<typeof sendWhatsAppMessage>>;
  try {
    result = await sendWhatsAppMessage(customerPhone, reply.text, businessId, {
      allowDryRun,
    });
  } catch (error) {
    result = { ok: false, error: (error as Error).message };
  }

  if (result.ok) {
    await finishOutboundMessage(reply.id, "sent");
    return "sent";
  }

  await finishOutboundMessage(reply.id, "failed", result.error);
  return "failed";
}

export async function ingestCustomerMessage(params: {
  businessId: string;
  customerPhone: string;
  customerName?: string | null;
  text: string;
  /** WhatsApp message.id. Required for webhook calls; optional for dashboard simulator. */
  messageId?: string;
  /** Only the dashboard simulator may complete without real WhatsApp credentials. */
  allowDryRun?: boolean;
}): Promise<{ chatId: string; botReply: string | null }> {
  const { businessId, customerPhone, customerName, text, messageId, allowDryRun } = params;
  if (messageId !== undefined && !messageId.trim()) {
    throw new Error("messageId cannot be empty");
  }

  const { data: chat, error } = await supabaseAdmin
    .from("chats")
    .upsert(
      {
        business_id: businessId,
        customer_phone: customerPhone,
        ...(customerName ? { customer_name: customerName } : {}),
        last_message: text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,customer_phone" },
    )
    .select("id, is_bot_active")
    .single();

  if (error || !chat) throw new Error(error?.message ?? "Failed to upsert chat");

  // The unique index on (chat_id, external_message_id) prevents duplicate
  // customer rows. The claim state machine then allows safe retries after a
  // crash/failure without letting concurrent duplicates run the agent twice.
  const incomingMessage = {
    chat_id: chat.id,
    sender: "customer" as const,
    text,
    ...(messageId ? { external_message_id: messageId, processing_status: "pending" } : {}),
  };
  const { error: insertError } = await supabaseAdmin.from("messages").insert(incomingMessage);

  let shouldProcess = true;

  if (insertError) {
    if (insertError.code === "23505" && messageId) {
      shouldProcess = await claimInboundMessage(chat.id, messageId);
    } else {
      throw new Error(`Failed to save customer message: ${insertError.message}`);
    }
  } else if (messageId) {
    shouldProcess = await claimInboundMessage(chat.id, messageId);
  }

  if (!shouldProcess) return { chatId: chat.id, botReply: null };

  try {
    // A previous attempt may have persisted the reply. Reuse it and retry only
    // the outbound submission instead of generating a second AI reply.
    const linkedReply = messageId
      ? await findLinkedReply(chat.id, messageId)
      : null;

    if (linkedReply) {
      if (linkedReply.deliveryStatus === "sent") {
        if (messageId) await finishInboundMessage(chat.id, messageId, "done");
        return { chatId: chat.id, botReply: null };
      }

      const existingDelivery = await deliverBotReply(
        linkedReply,
        customerPhone,
        businessId,
        Boolean(allowDryRun),
      );
      if (existingDelivery === "sent") {
        if (messageId) await finishInboundMessage(chat.id, messageId, "done");
        return { chatId: chat.id, botReply: null };
      }
      if (existingDelivery === "in_progress") {
        return { chatId: chat.id, botReply: null };
      }
      throw new Error("WhatsApp delivery failed");
    }

    if (!chat.is_bot_active) {
      if (messageId) await finishInboundMessage(chat.id, messageId, "done");
      return { chatId: chat.id, botReply: null };
    }

    const result = await runAgent({
      chatId: chat.id,
      customerPhone,
      userMessage: text,
      ...(messageId ? { messageId } : {}),
    });

    const delivery = await deliverBotReply(
      {
        id: result.botMessageId,
        text: result.reply,
        deliveryStatus: "pending",
      },
      customerPhone,
      businessId,
      Boolean(allowDryRun),
    );

    if (delivery === "in_progress") {
      return { chatId: chat.id, botReply: result.reply };
    }
    if (delivery !== "sent") {
      throw new Error("WhatsApp delivery failed");
    }

    if (messageId) await finishInboundMessage(chat.id, messageId, "done");
    return { chatId: chat.id, botReply: result.reply };
  } catch (error) {
    if (messageId) await finishInboundMessage(chat.id, messageId, "failed");
    throw error;
  }
}

