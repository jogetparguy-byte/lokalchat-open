/**
 * LokalChat AI agent orchestration (server-only).
 *
 * Runs a tool-calling loop against a configured OpenAI-compatible provider
 * with three tools: search_faq (pgvector RAG), check_stock (live inventory
 * HTTP fetch) and trigger_human_handoff (pauses the bot for this chat).
 */
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { accountPreferences, replyInstruction, type ReplyLanguage } from "./preferences";
import { createEmbedding } from "./embeddings.server";
import { sendWhatsAppMessage } from "./whatsapp.server";
import { recordWhatsAppAcceptance } from "./delivery-status.server";
import { buildAgentSystemPrompt } from "./agent-prompt.server";
import { enforceCommercialGrounding, readCommercialInventory } from "./commercial-grounding.server";

const HANDOFF_REPLY = "Permintaan bantuan manusia direkod untuk semakan pemilik. Balasan pemilik tidak serta-merta.";
class ChatSupersededError extends Error {}

export const SYSTEM_PROMPT = `Anda adalah AI customer service bernama LokalChat untuk kedai PKS Malaysia. Anda wajib faham Bahasa Melayu Pasar, English, dan Manglish (cth: 'ada stock tak?', 'pm harga boss', 'bila pos?'). Jawab dengan mesra (boleh guna sis/boss/bro). Gunakan fungsi 'search_faq' untuk mencari jawapan dan 'check_stock' untuk semak inventori. Jika soalan tiada dalam FAQ, atau pelanggan mahu bercakap dengan manusia, panggil fungsi 'trigger_human_handoff' segera (reason='no_answer' jika anda tidak pasti jawapannya, reason='customer_request' jika pelanggan minta manusia). Jangan reka jawapan yang tiada dalam FAQ.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "respond_to_customer",
      description:
        "Complete the reply with 1–3 ordered messages. Prefer one message for simple answers. Use separate messages only for distinct, useful points (answer, verified relevant promotion, optional next step). Never invent prices, discounts, deadlines or order capabilities. Do not force a promotion or sales question. Finish other lookups first; call this tool alone after obtaining the facts. Do not change the owner's selected model.",
      parameters: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", minLength: 1, maxLength: 4096 },
          },
        },
        required: ["messages"],
        additionalProperties: false,
      },
    },
  },
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
  const embedding = await createEmbedding(query, businessId);

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
  const stock = await readCommercialInventory(productName, businessId);
  return stock ? JSON.stringify(stock) : "Stok belum dapat disahkan. Sambungkan pelanggan kepada pemilik kedai.";
}

async function triggerHumanHandoff(chatId: string, generation: number, turnToken?: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("handoff_chat", {
    p_chat_id: chatId, p_generation: generation, p_token: turnToken ?? null,
  });
  if (error) throw new Error(`handoff update failed: ${error.message}`);
  if (data === null) throw new ChatSupersededError("Chat changed during AI processing");

  await supabaseAdmin.from("messages").insert({
    chat_id: chatId,
    sender: "system",
    text: "⚠️ Bot dimatikan — perbualan diserahkan kepada pemilik kedai.",
  });

  return data;
}

/* ------------------------------- runner --------------------------------- */

async function loadHistory(chatId: string, messageId?: string): Promise<ChatMessage[]> {
  const { data, error } = await supabaseAdmin.rpc("load_chat_turn_history", {
    p_chat_id: chatId, p_external_message_id: messageId ?? null,
  });
  if (error) throw new Error(`Unable to read chat history: ${error.message}`);
  return (data ?? []).map((m) => ({
    role: m.sender === "customer" ? ("user" as const) : ("assistant" as const),
    content: m.text,
  }));
}

async function callGateway(messages: ChatMessage[], businessId: string | null) {
  const { getActiveLlmConfig } = await import("./platform-key.server");
  if (!businessId) throw new Error("Pemilik perbualan tidak ditemui");
  const { baseUrl, model, apiKey } = await getActiveLlmConfig(businessId);

  const gatewayUrl = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const { LLM_PROVIDERS } = await import("./llm-settings");
  const isCustom = !Object.values(LLM_PROVIDERS).some((provider) => provider.baseUrl === baseUrl);
  const request = isCustom
    ? (await import("./ssrf.server")).fetchPublicHttp
    : (url: string, options: Parameters<typeof import("./ssrf.server").fetchPublicHttp>[1]) => fetch(url, { ...options, redirect: "error" });
  const res = await request(gatewayUrl, {
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
  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`AI gateway error ${res.status}${errorText ? `: ${errorText.slice(0, 200)}` : ""}`);
  }

  return (await res.json()) as {
    choices: Array<{ message: ChatMessage }>;
  };
}

export type AgentResult = {
  reply: string;
  replies: LinkedReply[];
  handedOff: boolean;
  /** Persisted bot message id; delivery is handled by the caller. */
  botMessageId: string;
};

export function parseResponseMessages(argumentsJson: string): string[] {
  const value: unknown = JSON.parse(argumentsJson);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a messages object");
  }
  const record = value as Record<string, unknown>;
  const rawMessages = record["messages"];
  if (Object.keys(record).length !== 1 || !Array.isArray(rawMessages)
    || rawMessages.length < 1 || rawMessages.length > 3) {
    throw new Error("Expected 1–3 messages");
  }
  const messages = rawMessages.map((text: unknown) => {
    if (typeof text !== "string" || !text.trim() || text.length > 4096) {
      throw new Error("Each message must contain 1–4096 characters");
    }
    return text.trim();
  });
  if (new Set(messages).size !== messages.length) {
    throw new Error("Messages must not repeat");
  }
  return messages;
}

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
  turnToken?: string;
}): Promise<AgentResult> {
  const { chatId, customerPhone, userMessage, messageId, turnToken } = params;

  const { data: chatRow, error: chatError } = await supabaseAdmin
    .from("chats")
    .select("business_id, is_bot_active, bot_generation")
    .eq("id", chatId)
    .maybeSingle();
  const businessId = chatRow?.business_id ?? null;
  if (chatError || !chatRow) throw new Error("Unable to read chat state");
  const cancelledResult = (): AgentResult => ({ reply: "", replies: [], handedOff: false, botMessageId: "" });
  if (!chatRow.is_bot_active) return cancelledResult();
  let generation = chatRow.bot_generation;

  let replyLanguage: ReplyLanguage = "auto";
  if (businessId) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(businessId);
    if (!error && data.user) replyLanguage = accountPreferences(data.user.user_metadata).replyLanguage;
  }
  const languageInstruction = replyInstruction(replyLanguage);
  const handoffReply = replyLanguage === "en" ? "Your request for human help is recorded for owner review. An immediate owner reply is not guaranteed." : HANDOFF_REPLY;
  const history = await loadHistory(chatId, messageId);

  const messages: ChatMessage[] = [
    { role: "system", content: "" },
    ...history,
  ];
  if (history.at(-1)?.content !== userMessage) {
    messages.push({ role: "user", content: userMessage });
  }

  let handedOff = false;
  let reply = "";
  let responseMessages: string[] | undefined;

  try {
    messages[0]!.content = await buildAgentSystemPrompt({ businessId, platformPrompt: SYSTEM_PROMPT, languageInstruction });
    for (let step = 0; step < 4; step += 1) {
      const completion = await callGateway(messages, businessId);
      const choice = completion.choices?.[0]?.message;
      if (!choice) break;

      messages.push(choice);

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        reply = (choice.content ?? "").trim();
        break;
      }

      const responseCall = toolCalls.find((call) => call.function.name === "respond_to_customer");
      if (responseCall) {
        if (toolCalls.length !== 1) {
          for (const call of toolCalls) {
            messages.push({ role: "tool", tool_call_id: call.id, content: "No tools executed. Complete lookups first; call respond_to_customer alone afterwards." });
          }
          continue;
        }
        try {
          responseMessages = parseResponseMessages(responseCall.function.arguments);
          reply = responseMessages.join("\n\n");
          break;
        } catch {
          messages.push({ role: "tool", tool_call_id: responseCall.id, content: "Invalid response. Supply 1–3 distinct non-empty strings, at most 4096 characters each, in the messages array." });
          continue;
        }
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
            generation = await triggerHumanHandoff(chatId, generation, turnToken);
            result = handoffReply;
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
        reply = handoffReply;
        break;
      }
    }
    if (!handedOff && reply) {
      const grounded = await enforceCommercialGrounding({
        businessId, userMessage, replies: responseMessages ?? [reply], replyLanguage,
        history: history.map(message => message.content ?? ""),
      });
      if (grounded.required) {
        if (grounded.replies) {
          responseMessages = grounded.replies;
          reply = responseMessages.join("\n\n");
        } else {
          generation = await triggerHumanHandoff(chatId, generation, turnToken);
          handedOff = true;
          responseMessages = undefined;
          reply = handoffReply;
          if (businessId) {
            const { recordUnansweredQuestion } = await import("./unanswered.server");
            await recordUnansweredQuestion({ businessId, chatId, question: userMessage });
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof ChatSupersededError) return cancelledResult();
    console.error("Agent run failed", { message: error instanceof Error ? error.message : String(error) });
    reply = replyLanguage === "en"
      ? "The assistant is temporarily unavailable. I’m contacting the store owner for you."
      : "Maaf boss, sistem saya ada gangguan sekejap. Saya panggil pemilik kedai ya.";
    if (!handedOff) {
      try { generation = await triggerHumanHandoff(chatId, generation, turnToken); }
      catch (handoffError) {
        if (handoffError instanceof ChatSupersededError) return cancelledResult();
        throw handoffError;
      }
      handedOff = true;
    }
  }

  if (!reply) {
    if (!handedOff) {
      try { generation = await triggerHumanHandoff(chatId, generation, turnToken); }
      catch (error) {
        if (error instanceof ChatSupersededError) return cancelledResult();
        throw error;
      }
    }
    handedOff = true;
    reply = handoffReply;
  }

  // One insert persists the complete batch atomically before any WhatsApp send.
  const { data: currentChat, error: currentError } = await supabaseAdmin.from("chats")
    .select("is_bot_active, bot_generation").eq("id", chatId).single();
  if (currentError || !currentChat) throw new Error("Unable to verify chat state");
  if (currentChat.bot_generation !== generation || (!handedOff && !currentChat.is_bot_active)) {
    return cancelledResult();
  }
  const parts = handedOff ? [reply] : responseMessages ?? [reply];
  const createdAt = new Date().toISOString();

  const { data: botMessages, error: botInsertError } = await supabaseAdmin
    .from("messages")
    .insert(parts.map((text, replySequence) => ({
      chat_id: chatId,
      sender: "bot" as const,
      text,
      created_at: createdAt,
      reply_sequence: replySequence,
      delivery_status: "pending",
      bot_generation: generation,
      bot_reply_kind: handedOff ? "handoff" : "answer",
      ...(messageId ? { reply_to_external_message_id: messageId } : {}),
    })))
    .select("id, text, reply_sequence, delivery_status");
  if (botInsertError || !botMessages || botMessages.length !== parts.length) {
    // Do not send a reply that was not persisted: the caller marks the inbound
    // message as failed so a later webhook retry can regenerate it.
    throw new Error(
      `Failed to save bot reply: ${botInsertError?.message ?? "no row returned"}`,
    );
  }
  await supabaseAdmin
    .from("chats")
    .update({ last_message: parts.at(-1)!, updated_at: new Date().toISOString() })
    .eq("id", chatId).eq("bot_generation", generation);

  const replies = botMessages.sort((a, b) => a.reply_sequence - b.reply_sequence).map((row) => ({
    id: row.id, text: row.text, deliveryStatus: row.delivery_status,
  }));
  return { reply, replies, handedOff, botMessageId: replies[0]!.id };
}

/**
 * Shared ingest path used by both the WhatsApp webhook and the dashboard
 * simulator: upsert chat, log the customer message, then run the bot when it
 * is active for that chat.
 */
async function claimInboundMessage(chatId: string, messageId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_chat_turn", {
    p_chat_id: chatId,
    p_external_message_id: messageId,
  });
  if (error) throw new Error(`Failed to claim inbound message: ${error.message}`);
  return data;
}

async function finishInboundMessage(
  chatId: string,
  messageId: string,
  turnToken: string,
  status: "done" | "failed",
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("finish_chat_turn", {
    p_chat_id: chatId,
    p_external_message_id: messageId,
    p_status: status,
    p_token: turnToken,
  });
  if (error) throw new Error(`Failed to finalize inbound message: ${error.message}`);
}

type LinkedReply = {
  id: string;
  text: string;
  deliveryStatus: string | null;
};

/** Loads the persisted batch in send order, including parts already sent. */
async function findLinkedReplies(
  chatId: string,
  messageId: string,
): Promise<LinkedReply[]> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id, text, delivery_status")
    .eq("chat_id", chatId)
    .eq("sender", "bot")
    .eq("reply_to_external_message_id", messageId)
    .order("reply_sequence", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id, text: row.text, deliveryStatus: row.delivery_status,
  }));
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
  if (error) throw new Error(`Failed to finalize outbound message: ${error.message}`);
}

/** Submits an already-persisted bot reply, retrying safely on later requests. */
async function deliverBotReply(
  reply: LinkedReply,
  customerPhone: string,
  businessId: string,
  allowDryRun: boolean,
  turnToken: string,
): Promise<"sent" | "in_progress" | "failed" | "blocked"> {
  if (reply.deliveryStatus === "sent") return "sent";
  const { data: claim, error: claimError } = await supabaseAdmin.rpc("claim_bot_reply", {
    p_message_id: reply.id,
    p_token: turnToken,
  });
  if (claimError) throw new Error(`Failed to claim bot reply: ${claimError.message}`);
  // Cancelled replies are consumed without external delivery, allowing the queue to advance.
  if (claim === "cancelled" || claim === "sent") return "sent";
  if (claim !== "claimed") return "in_progress";

  let result: Awaited<ReturnType<typeof sendWhatsAppMessage>>;
  try {
    result = await sendWhatsAppMessage(customerPhone, reply.text, businessId, {
      allowDryRun,
    });
  } catch (error) {
    result = { ok: false, error: (error as Error).message };
  }

  if (result.ok) {
    const tracked = await recordWhatsAppAcceptance(supabaseAdmin, businessId, reply.id, result);
    if (!tracked) await finishOutboundMessage(reply.id, "sent", result.error);
    return "sent";
  }

  await finishOutboundMessage(reply.id, "failed", result.error);
  return result.retryable === false ? "blocked" : "failed";
}

async function deliverBotReplies(
  replies: LinkedReply[],
  customerPhone: string,
  businessId: string,
  allowDryRun: boolean,
  turnToken: string,
): Promise<"sent" | "in_progress" | "failed" | "blocked"> {
  for (const reply of replies) {
    const status = await deliverBotReply(reply, customerPhone, businessId, allowDryRun, turnToken);
    // A failed or leased part blocks all later parts to preserve send order.
    if (status !== "sent") return status;
  }
  return "sent";
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
  /** Webhooks acknowledge only after durable insertion; recovery runs the agent. */
  enqueueOnly?: boolean;
  /** Recovery uses the original chat without rewriting its latest-message preview. */
  resumeChatId?: string;
}): Promise<{ chatId: string; botReply: string | null }> {
  const { businessId, customerPhone, customerName, text, messageId = randomUUID(), allowDryRun } = params;
  if (params.enqueueOnly && !messageId) throw new Error("Queued messages require messageId");
  if (messageId !== undefined && !messageId.trim()) {
    throw new Error("messageId cannot be empty");
  }

  const { data: chat, error } = params.resumeChatId
    ? await supabaseAdmin.from("chats").select("id, is_bot_active, bot_generation")
        .eq("id", params.resumeChatId).eq("business_id", businessId).single()
    : await supabaseAdmin
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
    .select("id, is_bot_active, bot_generation")
    .single();

  if (error || !chat) throw new Error(error?.message ?? "Failed to upsert chat");

  // The unique index on (chat_id, external_message_id) prevents duplicate
  // customer rows. The claim state machine then allows safe retries after a
  // crash/failure without letting concurrent duplicates run the agent twice.
  const incomingMessage = {
    chat_id: chat.id,
    sender: "customer" as const,
    text,
    allow_dry_run: Boolean(allowDryRun),
    bot_generation: chat.bot_generation,
    ...(messageId ? { external_message_id: messageId, processing_status: "pending" } : {}),
  };
  const { error: insertError } = params.resumeChatId
    ? { error: { code: "23505", message: "Resume persisted message" } }
    : await supabaseAdmin.from("messages").insert(incomingMessage);

  if (params.enqueueOnly) {
    if (!messageId) throw new Error("Queued messages require messageId");
    if (insertError && insertError.code !== "23505") {
      throw new Error(`Failed to queue customer message: ${insertError.message}`);
    }
    return { chatId: chat.id, botReply: null };
  }

  let shouldProcess: string | null = null;

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
    const linkedReplies = messageId
      ? await findLinkedReplies(chat.id, messageId)
      : [];

    if (linkedReplies.length) {
      const existingDelivery = await deliverBotReplies(
        linkedReplies,
        customerPhone,
        businessId,
        Boolean(allowDryRun),
        shouldProcess,
      );
      if (existingDelivery === "sent" || existingDelivery === "blocked") {
        if (messageId) await finishInboundMessage(chat.id, messageId, shouldProcess, "done");
        return { chatId: chat.id, botReply: null };
      }
      if (existingDelivery === "in_progress") {
        return { chatId: chat.id, botReply: null };
      }
      throw new Error("WhatsApp delivery failed");
    }

    if (!chat.is_bot_active) {
      if (messageId) await finishInboundMessage(chat.id, messageId, shouldProcess, "done");
      return { chatId: chat.id, botReply: null };
    }

    const result = await runAgent({
      chatId: chat.id,
      customerPhone,
      userMessage: text,
      turnToken: shouldProcess,
      ...(messageId ? { messageId } : {}),
    });

    const delivery = await deliverBotReplies(
      result.replies,
      customerPhone,
      businessId,
      Boolean(allowDryRun),
      shouldProcess,
    );

    if (delivery === "in_progress") {
      return { chatId: chat.id, botReply: result.reply };
    }
    if (delivery === "blocked") {
      if (messageId) await finishInboundMessage(chat.id, messageId, shouldProcess, "done");
      return { chatId: chat.id, botReply: null };
    }
    if (delivery !== "sent") {
      throw new Error("WhatsApp delivery failed");
    }

    if (messageId) await finishInboundMessage(chat.id, messageId, shouldProcess, "done");
    return { chatId: chat.id, botReply: result.reply };
  } catch (error) {
    if (messageId) await finishInboundMessage(chat.id, messageId, shouldProcess, "failed");
    throw error;
  }
}

