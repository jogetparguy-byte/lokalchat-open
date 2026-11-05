/**
 * Server functions used by the SME owner dashboard.
 * All of them require an authenticated owner session.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summarize, type MsgRow, type HandoffRow } from "./metrics";
import { safeDeliveryError, DELIVERY_ERRORS } from "./delivery-error";

async function claimOutboundMessage(messageId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("claim_outbound_message", {
    p_message_id: messageId,
  });
  if (error) throw new Error(DELIVERY_ERRORS.uncertain);
  return data === true;
}

async function finishOutboundMessage(
  messageId: string,
  status: "sent" | "failed",
  errorMessage?: string | null,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("finish_outbound_message", {
    p_message_id: messageId,
    p_status: status,
    p_error: safeDeliveryError(errorMessage),
  });
  if (error) throw new Error(DELIVERY_ERRORS.uncertain);
}

export const listChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("chats")
      .select("id, customer_phone, customer_name, is_bot_active, last_message, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select(
        "id, chat_id, sender, text, created_at, delivery_status, last_delivery_error, sent_at, delivery_attempts",
      )
      .eq("chat_id", data.chatId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(300);
    if (error) throw new Error(DELIVERY_ERRORS.uncertain);
    return (rows ?? []).reverse().map((row) => ({
      ...row,
      last_delivery_error: safeDeliveryError(row.last_delivery_error),
    }));
  });

export const setBotActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string; isActive: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chats")
      .update({ is_bot_active: data.isActive })
      .eq("id", data.chatId);
    if (error) throw new Error(error.message);

    await context.supabase.from("messages").insert({
      chat_id: data.chatId,
      sender: "system",
      text: data.isActive
        ? "✅ Bot diaktifkan semula oleh pemilik kedai."
        : "⚠️ Pemilik kedai mengambil alih perbualan.",
    });

    return { ok: true };
  });

export const sendHumanReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string; text: string; requestId?: string }) => {
    const text = input.text.trim();
    if (!text) throw new Error("Message cannot be empty");
    if (text.length > 2000) throw new Error("Message too long");
    const requestId = input.requestId?.trim();
    if (requestId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new Error("Invalid request ID");
    }
    return { chatId: input.chatId, text, requestId: requestId ?? null };
  })
  .handler(async ({ data, context }) => {
    // Verify tenant ownership before looking up an idempotency key or using
    // service-role delivery RPCs. The client never supplies a business ID.
    const { data: chat, error: chatError } = await context.supabase
      .from("chats")
      .select("customer_phone")
      .eq("id", data.chatId)
      .eq("business_id", context.userId)
      .single();
    if (chatError || !chat) throw new Error("Chat not found");

    const loadExisting = async () => {
      if (!data.requestId) return null;
      const { data: existing, error } = await context.supabase
        .from("messages")
        .select("id, text, delivery_status, last_delivery_error")
        .eq("chat_id", data.chatId)
        .eq("sender", "human")
        .eq("client_request_id", data.requestId)
        .maybeSingle();
      if (error) throw new Error(DELIVERY_ERRORS.uncertain);
      if (existing && existing.text !== data.text) {
        throw new Error("Request ID already belongs to a different message");
      }
      return existing;
    };
    type StoredReply = NonNullable<Awaited<ReturnType<typeof loadExisting>>>;
    const persistedResult = (message: StoredReply) => ({
      ok: message.delivery_status !== "failed",
      inProgress: message.delivery_status !== "sent" && message.delivery_status !== "failed",
      messageId: message.id,
      deliveryStatus: message.delivery_status,
      error: safeDeliveryError(message.last_delivery_error),
    });

    let humanMessage = await loadExisting();
    if (humanMessage && humanMessage.delivery_status !== "pending") {
      // A repeated HTTP request reconciles the same stored message. Failed
      // replies require the explicit retry-by-ID action; sending is uncertain
      // and must never be resent merely because the response was lost.
      return persistedResult(humanMessage);
    }
    if (!humanMessage) {
      const { data: inserted, error } = await context.supabase
        .from("messages")
        .insert({
          chat_id: data.chatId,
          sender: "human",
          text: data.text,
          delivery_status: "pending",
          client_request_id: data.requestId,
        })
        .select("id, text, delivery_status, last_delivery_error")
        .single();
      if (error || !inserted) {
        if (data.requestId && error?.code === "23505") {
          // Another concurrent request owns this insert. Return its state;
          // only that request may initiate delivery from this conflict path.
          const existing = await loadExisting();
          if (existing) return persistedResult(existing);
        }
        throw new Error("Mesej tidak dapat disimpan. Cuba lagi kemudian.");
      }
      humanMessage = inserted;

      const { error: previewError } = await context.supabase
        .from("chats")
        .update({ last_message: humanMessage.text, updated_at: new Date().toISOString() })
        .eq("id", data.chatId);
      if (previewError) console.error("Failed to update chat preview", previewError);
    }

    const claimed = await claimOutboundMessage(humanMessage.id);
    if (!claimed) {
      const { data: latest, error } = await context.supabase
        .from("messages")
        .select("id, text, delivery_status, last_delivery_error")
        .eq("id", humanMessage.id)
        .maybeSingle();
      if (error) throw new Error(DELIVERY_ERRORS.uncertain);
      return persistedResult(latest ?? humanMessage);
    }

    const { sendWhatsAppMessage } = await import("@/lib/whatsapp.server");
    const result = await sendWhatsAppMessage(chat.customer_phone, humanMessage.text, context.userId);

    if (!result.ok) {
      await finishOutboundMessage(humanMessage.id, "failed", result.error);
      // A persisted reply must be retried by ID. Returning its identity lets the
      // UI clear the draft without creating a second message on resubmission.
      return {
        ok: false,
        messageId: humanMessage.id,
        deliveryStatus: "failed" as const,
        error: safeDeliveryError(result.error) ?? DELIVERY_ERRORS.failed,
      };
    }

    await finishOutboundMessage(humanMessage.id, "sent");
    return { ok: true, messageId: humanMessage.id, deliveryStatus: "sent" };
  });

export const retryFailedHumanReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { messageId: string }) => {
    const messageId = input.messageId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) {
      throw new Error("ID mesej tidak sah");
    }
    return { messageId };
  })
  .handler(async ({ data, context }) => {
    const { data: message, error: messageError } = await context.supabase
      .from("messages")
      .select("id, chat_id, sender, text, delivery_status")
      .eq("id", data.messageId)
      .maybeSingle();
    if (messageError) throw new Error(DELIVERY_ERRORS.uncertain);
    if (!message) throw new Error("Message not found");
    if (message.sender !== "human") {
      throw new Error("Only human replies can be retried");
    }
    if (message.delivery_status === "sent") {
      return { ok: true, messageId: message.id, deliveryStatus: "sent" };
    }
    if (message.delivery_status !== "failed") {
      throw new Error("Only failed human replies can be retried");
    }

    // Explicit tenant check in addition to RLS. This also keeps the service
    // role claim below scoped to a verified owner.
    const { data: chat, error: chatError } = await context.supabase
      .from("chats")
      .select("customer_phone")
      .eq("id", message.chat_id)
      .eq("business_id", context.userId)
      .maybeSingle();
    if (chatError) throw new Error(DELIVERY_ERRORS.uncertain);
    if (!chat) throw new Error("Chat not found");

    const claimed = await claimOutboundMessage(message.id);
    if (!claimed) {
      const { data: latest } = await context.supabase
        .from("messages")
        .select("delivery_status")
        .eq("id", message.id)
        .maybeSingle();
      if (latest?.delivery_status === "sent") {
        return { ok: true, messageId: message.id, deliveryStatus: "sent" };
      }
      return {
        ok: true,
        inProgress: true,
        messageId: message.id,
        deliveryStatus: latest?.delivery_status ?? "sending",
      };
    }

    const { sendWhatsAppMessage } = await import("@/lib/whatsapp.server");
    const result = await sendWhatsAppMessage(
      chat.customer_phone,
      message.text,
      context.userId,
    );

    if (!result.ok) {
      await finishOutboundMessage(message.id, "failed", result.error);
      throw new Error(safeDeliveryError(result.error) ?? DELIVERY_ERRORS.failed);
    }

    await finishOutboundMessage(message.id, "sent");
    return { ok: true, messageId: message.id, deliveryStatus: "sent" };
  });

export const listFaqs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("knowledge_base")
      .select("id, content, embedding, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      content: row.content,
      created_at: row.created_at,
      has_embedding: row.embedding !== null,
    }));
  });

export const saveFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { question: string; answer: string }) => {
    const question = input.question.trim();
    const answer = input.answer.trim();
    if (!question || !answer) throw new Error("Soalan dan jawapan diperlukan");
    if (question.length > 500 || answer.length > 4000) throw new Error("Teks terlalu panjang");
    return { question, answer };
  })
  .handler(async ({ data, context }) => {
    const content = `Soalan: ${data.question}\nJawapan: ${data.answer}`;
    const { createEmbedding } = await import("@/lib/embeddings.server");
    const embedding = await createEmbedding(content, context.userId);

    const { error } = await context.supabase.from("knowledge_base").insert({
      business_id: context.userId,
      content,
      embedding: embedding ? (JSON.stringify(embedding) as unknown as string) : null,
    });
    if (error) throw new Error(error.message);

    return { ok: true, embedded: Boolean(embedding) };
  });

export const deleteFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: number }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("knowledge_base")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, business_name, inventory_api_url, owner_whatsapp")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: import("./profile-settings").ProfilePatch) => input)
  .handler(async ({ data, context }) => {
    const { validateProfilePatch } = await import("./profile-settings");
    const patch = validateProfilePatch(data);
    if (patch.inventory_api_url) {
      const { assertPublicHttpUrl } = await import("./ssrf.server");
      await assertPublicHttpUrl(patch.inventory_api_url);
    }
    // Only change the submitted section. Saving one panel must not overwrite another.
    const { data: rows, error } = await context.supabase.from("profiles")
      .update(patch).eq("id", context.userId).select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) {
      const { error: insertError } = await context.supabase.from("profiles")
        .insert({ id: context.userId, business_name: "Kedai Saya", ...patch });
      if (insertError) throw new Error(insertError.message);
    }
    return { ok: true };
  });

/** Dev/demo helper: simulate an inbound WhatsApp message from a customer. */
export const simulateIncoming = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; text: string }) => {
    const phone = input.phone.trim();
    const text = input.text.trim();
    if (!/^\+?\d{6,15}$/.test(phone)) throw new Error("Nombor telefon tidak sah");
    if (!text) throw new Error("Mesej kosong");
    return { phone, text };
  })
  .handler(async ({ data, context }) => {
    const { ingestCustomerMessage } = await import("@/lib/agent.server");
    const result = await ingestCustomerMessage({
      businessId: context.userId,
      customerPhone: data.phone,
      text: data.text,
      allowDryRun: true,
    });
    await context.supabase
      .from("profiles")
      .update({ simulator_tested_at: new Date().toISOString() })
      .eq("id", context.userId)
      .is("simulator_tested_at", null);
    return result;
  });

/* ------------------------------------------------------------------ *
 * Setup checklist
 * ------------------------------------------------------------------ */

function sessionKey(claims: Record<string, unknown>) {
  const sid = claims["session_id"];
  return typeof sid === "string" && sid ? sid : String(claims["iat"] ?? "");
}

export const getSetupChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const uid = context.userId;
    const [profileRes, docRes, waRes] = await Promise.all([
      sb
        .from("profiles")
        .select(
          "business_name, system_prompt, simulator_tested_at, checklist_dismissed_session, checklist_celebrated_at",
        )
        .eq("id", uid)
        .maybeSingle(),
      sb
        .from("kb_documents")
        .select("id", { count: "exact", head: true })
        .eq("business_id", uid)
        .eq("status", "processed"),
      sb
        .from("whatsapp_connections")
        .select("connection_status")
        .eq("business_id", uid)
        .maybeSingle(),
    ]);
    if (profileRes.error) throw new Error(profileRes.error.message);
    const p = profileRes.data;
    const name = (p?.business_name ?? "").trim();
    const business = !!name && name !== "Kedai Saya";
    const knowledge = (docRes.count ?? 0) > 0 || !!(p?.system_prompt ?? "").trim();
    const tested = knowledge && !!p?.simulator_tested_at;
    const whatsapp = tested && waRes.data?.connection_status === "connected";
    const steps = { business, knowledge, tested, whatsapp };
    const allDone = business && knowledge && tested && whatsapp;
    return {
      steps,
      allDone,
      celebrated: !!p?.checklist_celebrated_at,
      dismissed:
        !!p?.checklist_dismissed_session &&
        p.checklist_dismissed_session === sessionKey(context.claims as Record<string, unknown>),
    };
  });

export const updateSetupChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { action: "dismiss" | "celebrated" }) => {
    if (input.action !== "dismiss" && input.action !== "celebrated") throw new Error("Tindakan tidak sah");
    return input;
  })
  .handler(async ({ data, context }) => {
    const patch =
      data.action === "dismiss"
        ? { checklist_dismissed_session: sessionKey(context.claims as Record<string, unknown>) }
        : { checklist_celebrated_at: new Date().toISOString() };
    const { error } = await context.supabase.from("profiles").update(patch).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ *
 * Dashboard analytics
 * ------------------------------------------------------------------ */

type RangeKey = "24h" | "7d" | "30d";

const RANGE_MS: Record<RangeKey, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};


/** Had saiz fail knowledge base (selaras dengan had bucket storage). */
const KB_MAX_FILE_BYTES = 10 * 1024 * 1024;


function percentDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export const getDashboardMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { range: RangeKey }) => {
    const range = (["24h", "7d", "30d"] as RangeKey[]).includes(input.range)
      ? input.range
      : "7d";
    return { range };
  })
  .handler(async ({ data, context }) => {
    const windowMs = RANGE_MS[data.range];
    const now = Date.now();
    const currentStart = now - windowMs;
    const previousStart = now - windowMs * 2;
    const previousStartIso = new Date(previousStart).toISOString();

    const { data: chats, error: chatsError } = await context.supabase
      .from("chats")
      .select("id")
      .eq("business_id", context.userId);
    if (chatsError) throw new Error(chatsError.message);

    const chatIds = (chats ?? []).map((c) => c.id);
    if (chatIds.length === 0) {
      return {
        range: data.range,
        autoAnswered: 0,
        autoAnsweredDelta: null as number | null,
        totalMessages: 0,
        savedMinutes: 0,
        savedDelta: null as number | null,
        handoffRate: 0,
        handoffRateDelta: null as number | null,
        handoffSessions: 0,
        totalSessions: 0,
        reasons: [] as {
          reason: string;
          action: string | null;
          count: number;
          percent: number;
        }[],
        totalHandoffs: 0,
      };
    }

    const { data: messages, error: messagesError } = await context.supabase
      .from("messages")
      .select("chat_id, created_at")
      .in("chat_id", chatIds)
      .gte("created_at", previousStartIso)
      .order("created_at", { ascending: true })
      .limit(20000);
    if (messagesError) throw new Error(messagesError.message);

    const { data: handoffs, error: handoffError } = await context.supabase
      .from("handoff_events")
      .select("chat_id, created_at, ai_reason, ai_suggested_action")
      .eq("business_id", context.userId)
      .gte("created_at", previousStartIso)
      .limit(5000);
    if (handoffError) throw new Error(handoffError.message);

    const allMessages = (messages ?? []) as MsgRow[];
    const allHandoffs = (handoffs ?? []) as HandoffRow[];

    const inCurrent = <T extends { created_at: string }>(row: T) =>
      new Date(row.created_at).getTime() >= currentStart;
    const inPrevious = <T extends { created_at: string }>(row: T) =>
      new Date(row.created_at).getTime() < currentStart;

    const current = summarize(
      allMessages.filter(inCurrent),
      allHandoffs.filter(inCurrent),
    );
    const previous = summarize(
      allMessages.filter(inPrevious),
      allHandoffs.filter(inPrevious),
    );

    // Reason breakdown for the current window only.
    const currentHandoffs = allHandoffs.filter(inCurrent);
    const grouped = new Map<
      string,
      { reason: string; action: string | null; count: number }
    >();
    for (const h of currentHandoffs) {
      const reason = (h.ai_reason ?? "Sebab tidak direkodkan").trim();
      const existing = grouped.get(reason);
      if (existing) {
        existing.count += 1;
        if (!existing.action && h.ai_suggested_action) {
          existing.action = h.ai_suggested_action;
        }
      } else {
        grouped.set(reason, {
          reason,
          action: h.ai_suggested_action,
          count: 1,
        });
      }
    }

    const totalHandoffs = currentHandoffs.length;
    const reasons = [...grouped.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((entry) => ({
        ...entry,
        percent: totalHandoffs ? (entry.count / totalHandoffs) * 100 : 0,
      }));

    return {
      range: data.range,
      autoAnswered: current.autoAnswered,
      autoAnsweredDelta: percentDelta(current.autoAnswered, previous.autoAnswered),
      totalMessages: current.totalMessages,
      savedMinutes: Math.round(current.savedMs / 60000),
      savedDelta: percentDelta(current.savedMs, previous.savedMs),
      handoffRate: current.handoffRate,
      handoffRateDelta: percentDelta(current.handoffRate, previous.handoffRate),
      handoffSessions: current.handoffSessions,
      totalSessions: current.totalSessions,
      reasons,
      totalHandoffs,
    };
  });

/* ------------------------------------------------------------------ *
 * Knowledge base documents + system prompt
 * ------------------------------------------------------------------ */

export const listKbDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("kb_documents")
      .select("id, file_name, file_type, file_size, storage_path, status, status_message, created_at")
      .eq("business_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const recordKbDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      fileName: string;
      fileType: string;
      fileSize: number;
      storagePath: string;
    }) => {
      const fileName = input.fileName.trim();
      if (!fileName) throw new Error("Nama fail diperlukan");
      if (!input.storagePath.trim()) throw new Error("Laluan fail tidak sah");
      const fileType = input.fileType.trim().toLowerCase();
      if (!["pdf", "docx", "doc", "csv", "txt"].includes(fileType)) {
        throw new Error("Jenis fail tidak disokong");
      }
      const fileSize = Math.max(0, Math.floor(input.fileSize));
      if (fileSize <= 0 || fileSize > KB_MAX_FILE_BYTES) {
        throw new Error("Saiz fail melebihi had 10MB");
      }
      return {
        fileName,
        fileType: fileType.toUpperCase(),
        fileSize,
        storagePath: input.storagePath.trim(),
      };
    },
  )
  .handler(async ({ data, context }) => {
    if (!data.storagePath.startsWith(`${context.userId}/`)) {
      throw new Error("Laluan fail tidak sah");
    }
    const { data: row, error } = await context.supabase
      .from("kb_documents")
      .insert({
        business_id: context.userId,
        file_name: data.fileName,
        file_type: data.fileType,
        file_size: data.fileSize,
        storage_path: data.storagePath,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

/**
 * Extract text from an uploaded document, chunk it, embed each chunk and
 * insert it into `knowledge_base` so `search_faq` can retrieve it.
 * Failures are recorded on the document row instead of throwing.
 */
export const processKbDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: doc, error: docError } = await context.supabase
      .from("kb_documents")
      .select("id, file_name, file_type, storage_path")
      .eq("id", data.id)
      .eq("business_id", context.userId)
      .maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!doc) throw new Error("Dokumen tidak dijumpai");

    const fail = async (message: string) => {
      await context.supabase
        .from("kb_documents")
        .update({ status: "failed", status_message: message })
        .eq("id", doc.id)
        .eq("business_id", context.userId);
      return { ok: false, status: "failed" as const, message };
    };

    try {
      // Re-validate the REAL object size from storage metadata before
      // downloading — the client-supplied file_size cannot be trusted.
      const slash = doc.storage_path.lastIndexOf("/");
      const folder = slash >= 0 ? doc.storage_path.slice(0, slash) : "";
      const objectName = slash >= 0 ? doc.storage_path.slice(slash + 1) : doc.storage_path;
      const { data: listing, error: listError } = await context.supabase.storage
        .from("kb-documents")
        .list(folder, { search: objectName, limit: 1 });
      if (listError) return await fail("Gagal menyemak fail");
      const objectMeta = listing?.find((o) => o.name === objectName);
      const actualSize = (objectMeta?.metadata as { size?: number } | undefined)?.size ?? 0;
      if (!objectMeta || actualSize <= 0) return await fail("Fail tidak dijumpai dalam storan");
      if (actualSize > KB_MAX_FILE_BYTES) {
        return await fail("Saiz fail melebihi had 10MB");
      }

      const { data: blob, error: dlError } = await context.supabase.storage
        .from("kb-documents")
        .download(doc.storage_path);
      if (dlError || !blob) return await fail("Gagal memuat turun fail");
      if (blob.size > KB_MAX_FILE_BYTES) {
        return await fail("Saiz fail melebihi had 10MB");
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { extractDocumentText, chunkText } = await import("@/lib/kb-extract.server");
      const text = await extractDocumentText(doc.file_type, bytes);
      const chunks = chunkText(text);
      if (chunks.length === 0) return await fail("Tiada teks dijumpai dalam fail");

      const { createEmbedding } = await import("@/lib/embeddings.server");
      const rows: {
        business_id: string;
        document_id: string;
        content: string;
        embedding: string | null;
      }[] = [];
      for (const chunk of chunks) {
        const content = `Dokumen: ${doc.file_name}\n${chunk}`;
        const embedding = await createEmbedding(content, context.userId);
        rows.push({
          business_id: context.userId,
          document_id: doc.id,
          content,
          embedding: embedding ? (JSON.stringify(embedding) as unknown as string) : null,
        });
      }

      for (let i = 0; i < rows.length; i += 50) {
        const { error } = await context.supabase
          .from("knowledge_base")
          .insert(rows.slice(i, i + 50));
        if (error) return await fail(error.message);
      }

      await context.supabase
        .from("kb_documents")
        .update({ status: "processed", status_message: null })
        .eq("id", doc.id)
        .eq("business_id", context.userId);

      return { ok: true, status: "processed" as const, chunks: chunks.length };
    } catch (error) {
      return await fail((error as Error).message || "Ralat memproses fail");
    }
  });

/**
 * Delete a knowledge base document: its embedded chunks, the stored file and
 * the document row — all scoped to the authenticated business.
 */
export const deleteKbDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string }) => {
    const documentId = input.documentId?.trim();
    if (!documentId) throw new Error("ID dokumen diperlukan");
    return { documentId };
  })
  .handler(async ({ data, context }) => {
    const { data: doc, error: docError } = await context.supabase
      .from("kb_documents")
      .select("id, storage_path")
      .eq("id", data.documentId)
      .eq("business_id", context.userId)
      .maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!doc) throw new Error("Dokumen tidak dijumpai");

    const { error: chunkError } = await context.supabase
      .from("knowledge_base")
      .delete()
      .eq("document_id", doc.id)
      .eq("business_id", context.userId);
    if (chunkError) throw new Error(chunkError.message);

    const { error: storageError } = await context.supabase.storage
      .from("kb-documents")
      .remove([doc.storage_path]);
    if (storageError) throw new Error(storageError.message);

    const { error: rowError } = await context.supabase
      .from("kb_documents")
      .delete()
      .eq("id", doc.id)
      .eq("business_id", context.userId);
    if (rowError) throw new Error(rowError.message);

    return { ok: true, id: doc.id };
  });


export const getSystemPrompt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("business_name, system_prompt")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const saveSystemPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { systemPrompt: string }) => {
    const systemPrompt = input.systemPrompt.trim();
    if (systemPrompt.length > 8000) throw new Error("System prompt terlalu panjang");
    return { systemPrompt };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ system_prompt: data.systemPrompt || null })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------- WhatsApp connection --------------------------- */

export const getWhatsappConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("whatsapp_connections")
      .select(
        "phone_number_id, display_phone_number, waba_id, connection_status, last_verified_at, last_error_message",
      )
      .eq("business_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const saveWhatsappConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      phoneNumberId: string;
      accessToken: string;
      appSecret: string;
      verifyToken: string;
    }) => {
      const phoneNumberId = input.phoneNumberId.trim();
      const accessToken = input.accessToken.trim();
      const appSecret = input.appSecret.trim();
      const verifyToken = input.verifyToken.trim();
      if (!phoneNumberId) throw new Error("Phone Number ID diperlukan");
      if (!accessToken) throw new Error("Access Token diperlukan");
      if (!appSecret) throw new Error("App Secret diperlukan");
      if (!verifyToken) throw new Error("Verify Token diperlukan");
      return { phoneNumberId, accessToken, appSecret, verifyToken };
    },
  )
  .handler(async ({ data, context }) => {
    const { fetchPhoneNumberDetails } = await import("@/lib/whatsapp.server");

    let details: { display_phone_number: string | null; waba_id: string | null };
    try {
      details = await fetchPhoneNumberDetails(data.phoneNumberId, data.accessToken);
    } catch (error) {
      throw new Error(
        `Meta menolak kredensial ini: ${(error as Error).message}. Sambungan tidak disimpan.`,
      );
    }

    const { encryptSecret } = await import("@/lib/wa-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("whatsapp_connections").upsert(
      {
        business_id: context.userId,
        phone_number_id: data.phoneNumberId,
        verify_token: data.verifyToken,
        access_token_encrypted: encryptSecret(data.accessToken),
        app_secret_encrypted: encryptSecret(data.appSecret),
        display_phone_number: details.display_phone_number,
        waba_id: details.waba_id,
        connection_status: "connected",
        last_verified_at: new Date().toISOString(),
        last_error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" },
    );
    if (error) throw new Error(error.message);

    return {
      ok: true,
      display_phone_number: details.display_phone_number,
    };
  });

/* ------------------------------ Admin only ------------------------------- */

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("role")
    .eq("id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.role !== "admin") throw new Error("FORBIDDEN");
}

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { role: (data?.role ?? "sme") as string };
  });

export const getAdminMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { range: RangeKey }) => ({
    range: (["24h", "7d", "30d"] as RangeKey[]).includes(input.range) ? input.range : "7d",
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const now = Date.now();
    const windowMs = RANGE_MS[data.range];
    const sinceIso = new Date(now - windowMs).toISOString();
    const since14Iso = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [msgsRes, msgs14Res, profilesRes, chatsRes, handoffRes] = await Promise.all([
      context.supabase
        .from("messages")
        .select("sender, created_at, chats!inner(business_id)")
        .gte("created_at", sinceIso)
        .limit(20000),
      context.supabase
        .from("messages")
        .select("chats!inner(business_id)")
        .gte("created_at", since14Iso)
        .limit(20000),
      context.supabase.from("profiles").select("id, created_at, role").limit(5000),
      context.supabase.from("chats").select("id").gte("created_at", sinceIso).limit(20000),
      context.supabase
        .from("handoff_events")
        .select("chat_id")
        .gte("created_at", sinceIso)
        .limit(20000),
    ]);

    for (const res of [msgsRes, msgs14Res, profilesRes, chatsRes, handoffRes]) {
      if (res.error) throw new Error(res.error.message);
    }

    const msgs = (msgsRes.data ?? []) as Array<{
      sender: string;
      created_at: string;
      chats: { business_id: string } | { business_id: string }[];
    }>;
    const businessOf = (row: { chats: any }) =>
      (Array.isArray(row.chats) ? row.chats[0]?.business_id : row.chats?.business_id) as
        | string
        | undefined;

    const activeSet = new Set<string>();
    let autoAnswered = 0;
    for (const m of msgs) {
      const b = businessOf(m);
      if (b) activeSet.add(b);
      if (m.sender === "bot") autoAnswered += 1;
    }

    const active14 = new Set<string>();
    for (const m of (msgs14Res.data ?? []) as Array<{ chats: any }>) {
      const b = businessOf(m);
      if (b) active14.add(b);
    }

    const profiles = (profilesRes.data ?? []) as Array<{
      id: string;
      created_at: string;
      role: string;
    }>;
    const smeProfiles = profiles.filter((p) => p.role !== "admin");
    const silentSmes = smeProfiles.filter((p) => !active14.has(p.id)).length;

    // Signup trend buckets
    const bucketCount = data.range === "24h" ? 8 : data.range === "7d" ? 7 : 30;
    const bucketMs = windowMs / bucketCount;
    const dayNames = ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"];
    const trend = Array.from({ length: bucketCount }, (_, i) => {
      const start = now - windowMs + i * bucketMs;
      const date = new Date(start + bucketMs);
      const label =
        data.range === "24h"
          ? `${String(date.getUTCHours()).padStart(2, "0")}h`
          : data.range === "7d"
            ? dayNames[date.getUTCDay()]!
            : `${date.getUTCDate()}`;
      return { label, count: 0, start, end: start + bucketMs };
    });
    for (const p of profiles) {
      const t = new Date(p.created_at).getTime();
      const bucket = trend.find((b) => t >= b.start && t < b.end);
      if (bucket) bucket.count += 1;
    }

    const chatIds = ((chatsRes.data ?? []) as Array<{ id: string }>).map((c) => c.id);
    const chatIdSet = new Set(chatIds);
    const handoffChats = new Set(
      ((handoffRes.data ?? []) as Array<{ chat_id: string }>)
        .map((h) => h.chat_id)
        .filter((id) => chatIdSet.has(id)),
    );
    const handoffRate = chatIds.length ? (handoffChats.size / chatIds.length) * 100 : 0;

    return {
      range: data.range,
      activeSmes: activeSet.size,
      silentSmes,
      totalSmes: smeProfiles.length,
      autoAnswered,
      signupTrend: trend.map((b) => ({ label: b.label, count: b.count })),
      handoffRate,
      handoffChats: handoffChats.size,
      totalChats: chatIds.length,
    };
  });

export const getPlatformApiKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("platform_api_keys")
      .select("provider, is_active, updated_at")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

/** Each authenticated owner manages only their own credentials; no admin role is required. */
export const getLlmSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getLlmEnvSettings } = await import("./llm-env.server");
    return { canManage: true as const, ...await getLlmEnvSettings(context.userId) };
  });

export const saveLlmSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(async (input: unknown) => {
    const { validateLlmSettings } = await import("./llm-settings");
    return validateLlmSettings(input);
  })
  .handler(async ({ data, context }) => {
    if (data.provider === "custom") {
      const { assertPublicHttpUrl } = await import("./ssrf.server");
      try { await assertPublicHttpUrl(data.baseUrl); }
      catch { throw new Error("Base URL mesti merujuk kepada endpoint HTTPS awam yang boleh dicapai"); }
    }
    const { saveLlmEnvSettings } = await import("./llm-env.server");
    return { canManage: true as const, ...await saveLlmEnvSettings(context.userId, data) };
  });

/** Supabase credentials are private to the verified account. */
export const getSupabaseSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getSupabaseEnvSettings } = await import("./supabase-env.server");
    return { canManage: true as const, ...await getSupabaseEnvSettings(context.userId) };
  });

export const saveSupabaseSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(async (input: unknown) => {
    const { validateSupabaseSettings } = await import("./supabase-settings");
    return validateSupabaseSettings(input);
  })
  .handler(async ({ data, context }) => {
    const { saveSupabaseEnvSettings } = await import("./supabase-env.server");
    return { canManage: true as const, ...await saveSupabaseEnvSettings(context.userId, data) };
  });

export const savePlatformApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: string; apiKey: string }) => {
    const provider = input.provider.trim();
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new Error("Kunci API diperlukan");
    if (apiKey.length > 500) throw new Error("Kunci API terlalu panjang");
    return { provider, apiKey };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { isProviderId, verifyProviderKey } = await import("@/lib/platform-key.server");
    if (!isProviderId(data.provider)) throw new Error("Penyedia tidak disokong");

    await verifyProviderKey(data.provider, data.apiKey);

    const { encryptSecret } = await import("@/lib/wa-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: deactivateError } = await supabaseAdmin
      .from("platform_api_keys")
      .update({ is_active: false })
      .neq("provider", data.provider);
    if (deactivateError) throw new Error(deactivateError.message);

    const { error } = await supabaseAdmin.from("platform_api_keys").upsert(
      {
        provider: data.provider,
        api_key_encrypted: encryptSecret(data.apiKey),
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider" },
    );
    if (error) throw new Error(error.message);

    return { ok: true, provider: data.provider };
  });

/* ------------------------ Unanswered questions ------------------------- */

type UqSort = "most_asked" | "newest" | "oldest";
type UqStatus = "all" | "unanswered" | "resolved" | "dismissed";

export const listUnansweredQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sort: UqSort; status: UqStatus }) => {
    const sorts: UqSort[] = ["most_asked", "newest", "oldest"];
    const statuses: UqStatus[] = ["all", "unanswered", "resolved", "dismissed"];
    if (!sorts.includes(input.sort) || !statuses.includes(input.status)) throw new Error("Input tidak sah");
    return input;
  })
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("unanswered_questions")
      .select(
        "id, question, status, occurrence_count, failed_after_faq_count, last_failed_after_faq_at, first_asked_at, last_asked_at, resolved_at",
      )
      .eq("business_id", context.userId);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.sort === "most_asked") q = q.order("occurrence_count", { ascending: false }).order("last_asked_at", { ascending: false });
    else if (data.sort === "newest") q = q.order("last_asked_at", { ascending: false });
    else q = q.order("first_asked_at", { ascending: true });
    const { data: rows, error } = await q.limit(200);
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    const latest = new Map<string, { customer_name: string | null; customer_phone: string | null }>();
    if (ids.length) {
      const { data: occ } = await context.supabase
        .from("unanswered_question_occurrences")
        .select("question_id, customer_name, customer_phone, created_at")
        .in("question_id", ids)
        .order("created_at", { ascending: false })
        .limit(1000);
      for (const o of occ ?? []) if (!latest.has(o.question_id)) latest.set(o.question_id, o);
    }
    return (rows ?? []).map((r) => ({ ...r, last_customer: latest.get(r.id) ?? null }));
  });

export const getUnansweredQuestionDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: occ, error } = await context.supabase
      .from("unanswered_question_occurrences")
      .select("id, question_text, customer_name, customer_phone, chat_id, failed_after_faq, created_at")
      .eq("question_id", data.id)
      .eq("business_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return occ ?? [];
  });

export const dismissUnansweredQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("unanswered_questions")
      .update({ status: "dismissed" })
      .eq("id", data.id)
      .eq("business_id", context.userId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Soalan tidak dijumpai");
    return { ok: true };
  });

export const resolveUnansweredWithFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; question: string; answer: string }) => {
    const question = input.question.trim();
    const answer = input.answer.trim();
    if (!question || !answer) throw new Error("Soalan dan jawapan diperlukan");
    if (question.length > 500 || answer.length > 4000) throw new Error("Teks terlalu panjang");
    return { id: input.id, question, answer };
  })
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("unanswered_questions")
      .select("id")
      .eq("id", data.id)
      .eq("business_id", context.userId)
      .maybeSingle();
    if (!existing) throw new Error("Soalan tidak dijumpai");

    const content = `Soalan: ${data.question}\nJawapan: ${data.answer}`;
    const { createEmbedding } = await import("@/lib/embeddings.server");
    const embedding = await createEmbedding(content, context.userId);
    const { data: faq, error } = await context.supabase
      .from("knowledge_base")
      .insert({
        business_id: context.userId,
        content,
        embedding: embedding ? (JSON.stringify(embedding) as unknown as string) : null,
      })
      .select("id")
      .single();
    if (error || !faq) throw new Error(error?.message ?? "Gagal simpan FAQ");

    const { error: upErr } = await context.supabase
      .from("unanswered_questions")
      .update({ status: "resolved", faq_id: faq.id, resolved_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("business_id", context.userId);
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

