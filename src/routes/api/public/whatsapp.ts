
/**
 * WhatsApp Business Cloud API webhook.
 * GET  -> Meta verification handshake, matched to a business by verify_token.
 * POST -> incoming customer messages. The X-Hub-Signature-256 header is
 *         verified against the tenant's app secret BEFORE anything is written.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/whatsapp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        if (mode !== "subscribe" || !token) {
          return new Response("Forbidden", { status: 403 });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: connection } = await supabaseAdmin
        .from("whatsapp_connections")
        .select("business_id")
        .eq("verify_token", token)
        .maybeSingle();

        if (!connection?.business_id) {
          return new Response("Forbidden", { status: 403 });
        }

        return new Response(challenge ?? "", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      },

      POST: async ({ request }) => {
        // Limit webhook body size to 1MB to prevent resource exhaustion
        const MAX_BODY_SIZE = 1024 * 1024;
        const contentLength = request.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
          return new Response("Payload too large", { status: 413 });
        }

        const rawBody = await request.text();
        if (rawBody.length > MAX_BODY_SIZE) {
          return new Response("Payload too large", { status: 413 });
        }
        const signature = request.headers.get("x-hub-signature-256");

        let payload: any;

        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const changes = (Array.isArray(payload?.entry) ? payload.entry : [])
          .flatMap((entry: any) => Array.isArray(entry?.changes) ? entry.changes : []);
        if (!changes.length) return new Response("Bad request", { status: 400 });

        const { createHmac, timingSafeEqual } = await import("node:crypto");
        const { decryptSecret } = await import("@/lib/wa-crypto.server");
        const verified = new Map<string, string>();
        // Verify every account represented in the envelope before any write.
        for (const change of changes) {
          const phoneNumberId = change?.value?.metadata?.phone_number_id;
          if (typeof phoneNumberId !== "string" || !phoneNumberId) {
            return new Response("Bad request", { status: 400 });
          }
          if (verified.has(phoneNumberId)) continue;
          const { data: connection, error } = await supabaseAdmin
            .from("whatsapp_connections")
            .select("business_id, app_secret_encrypted")
            .eq("phone_number_id", phoneNumberId)
            .maybeSingle();
          if (error) return new Response("Connection lookup failed", { status: 500 });
          if (!connection?.business_id || !connection?.app_secret_encrypted) {
            return new Response("Unauthorized", { status: 401 });
          }
          let appSecret: string;
          try {
            appSecret = decryptSecret(connection.app_secret_encrypted);
          } catch {
            return new Response("Unauthorized", { status: 401 });
          }
          const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
          const provided = Buffer.from(signature ?? "");
          const expectedBytes = Buffer.from(expected);
          if (provided.length !== expectedBytes.length || !timingSafeEqual(provided, expectedBytes)) {
            return new Response("Unauthorized", { status: 401 });
          }
          verified.set(phoneNumberId, connection.business_id);
        }

        let processingFailed = false;

        try {
          const { normalizeWhatsAppInbound } = await import("@/lib/whatsapp-inbound");
          const { processWhatsAppStatuses } = await import("@/lib/delivery-status.server");
          const { providerEventTime } = await import("@/lib/whatsapp-window.server");
          for (const change of changes) {
            const value = change.value;
            const phoneNumberId = value.metadata.phone_number_id as string;
            const businessId = verified.get(phoneNumberId)!;
            await processWhatsAppStatuses({ supabase: supabaseAdmin, userId: businessId, phoneNumberId, statuses: value.statuses });
            if (value.messages != null && !Array.isArray(value.messages)) throw new Error("Invalid WhatsApp messages collection");
            for (const rawMessage of Array.isArray(value.messages) ? value.messages : []) {
              const message = normalizeWhatsAppInbound(rawMessage, value.contacts);
              const { data, error } = await supabaseAdmin.rpc("persist_whatsapp_inbound", {
                p_business_id: businessId,
                p_external_message_id: message.messageId,
                p_phone: message.phone,
                p_bsuid: message.bsuid,
                p_name: message.name,
                p_type: message.type,
                p_text: message.text,
                p_metadata: message.metadata as import("@/integrations/supabase/types").Json,
                p_needs_handoff: message.needsHandoff,
                p_phone_number_id: phoneNumberId,
                p_provider_timestamp: message.opensServiceWindow ? providerEventTime(message.timestamp) : null,
              });
              if (error || !data?.[0]?.chat_id) throw new Error("WhatsApp inbound durable persistence failed");
            }
          }
        } catch (error) {
          console.error("WhatsApp webhook processing failed", error);
          processingFailed = true;
        }

        // Acknowledge durable insertion only. The recovery worker owns AI and delivery.
        return new Response(processingFailed ? "PROCESSING_FAILED" : "EVENT_RECEIVED", {
          status: processingFailed ? 500 : 200,
        });
      },
    },
  },
});
