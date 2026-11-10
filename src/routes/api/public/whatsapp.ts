
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

        // Every entry in one delivery belongs to the same phone number id.
        const phoneNumberId: string | undefined =
        payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

        if (!phoneNumberId) {
          return new Response("Bad request", { status: 400 });
        }

        const { data: connection } = await supabaseAdmin
        .from("whatsapp_connections")
        .select("business_id, app_secret_encrypted")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();

        const businessId = connection?.business_id;

        if (!businessId || !connection?.app_secret_encrypted) {
          console.error(
            "No usable whatsapp_connections row for",
            phoneNumberId
          );

          return new Response("Unauthorized", { status: 401 });
        }

        // --- Signature verification (before any DB write) ---
        const { createHmac, timingSafeEqual } = await import("node:crypto");
        const { decryptSecret } = await import("@/lib/wa-crypto.server");

        let appSecret: string;

        try {
          appSecret = decryptSecret(connection.app_secret_encrypted);
        } catch (error) {
          console.error("Failed to decrypt app secret", error);
          return new Response("Unauthorized", { status: 401 });
        }

        const expected =
        "sha256=" +
        createHmac("sha256", appSecret)
        .update(rawBody, "utf8")
        .digest("hex");

        const provided = signature ?? "";
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);

        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          console.error(
            "Invalid X-Hub-Signature-256 for",
            phoneNumberId
          );

          return new Response("Unauthorized", { status: 401 });
        }

        let processingFailed = false;

        try {
          const { ingestCustomerMessage } = await import(
            "@/lib/agent.server"
          );

          for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
            for (const change of entry?.changes ?? []) {
              const value = change?.value;

              if (value?.metadata?.phone_number_id !== phoneNumberId) {
                continue;
              }

              const contacts = value?.contacts ?? [];

              for (const message of value?.messages ?? []) {
                if (message?.type !== "text") continue;

                const from: string | undefined = message.from;
                const text: string | undefined = message.text?.body;

                // NEW: Get unique WhatsApp message ID
                const messageId: string | undefined = message.id;

                // NEW: Require message ID for deduplication
                if (!from || !text || !messageId) continue;

                const name =
                contacts.find((c: any) => c?.wa_id === from)
                ?.profile?.name ?? null;

                // NEW: Pass messageId to ingestion function
                await ingestCustomerMessage({
                  businessId,
                  customerPhone: from,
                  customerName: name,
                  text,
                  messageId,
                });
              }
            }
          }
        } catch (error) {
          console.error("WhatsApp webhook processing failed", error);
          processingFailed = true;
        }

        // Ack successful/deduplicated deliveries. A processing failure returns
        // 5xx so Meta retries; the inbound claim state makes that retry safe.
        return new Response(processingFailed ? "PROCESSING_FAILED" : "EVENT_RECEIVED", {
          status: processingFailed ? 500 : 200,
        });
      },
    },
  },
});
