/**
 * WhatsApp Business Cloud API helpers (server-only).
 *
 * Credentials are per-tenant and live (encrypted) in whatsapp_connections.
 * Sending is a no-op (logged) when a business has no connection configured,
 * so the dashboard + simulator still work end-to-end during development.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "./wa-crypto.server";
import { DELIVERY_ERRORS, deliveryErrorForStatus } from "./delivery-error";
import { customerServiceWindowOpen, whatsappRecipientId } from "./whatsapp-window.server";

export const GRAPH_VERSION = process.env["WHATSAPP_GRAPH_VERSION"] || "v21.0";

export type WhatsappCredentials = {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string | null;
};

/** Loads and decrypts the credentials for a business, or null when unset. */
export async function getWhatsappCredentials(
  businessId: string,
): Promise<WhatsappCredentials | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("phone_number_id, access_token_encrypted, app_secret_encrypted")
    .eq("business_id", businessId)
    .maybeSingle();

  if (!data?.access_token_encrypted) return null;

  try {
    return {
      phoneNumberId: data.phone_number_id,
      accessToken: decryptSecret(data.access_token_encrypted),
      appSecret: data.app_secret_encrypted ? decryptSecret(data.app_secret_encrypted) : null,
    };
  } catch {
    console.error("Failed to decrypt WhatsApp credentials");
    return null;
  }
}

/** Flags a connection as broken so the dashboard shows the reconnect banner. */
export async function markConnectionInvalid(
  businessId: string,
  message: string,
): Promise<void> {
  await supabaseAdmin
    .from("whatsapp_connections")
    .update({
      connection_status: "invalid",
      last_error_message: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId);
}

/** Verifies credentials against the Graph API and returns the phone details. */
export async function fetchPhoneNumberDetails(
  phoneNumberId: string,
  accessToken: string,
): Promise<{ display_phone_number: string | null; waba_id: string | null }> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,id`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    },
  );

  const body = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const detail = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }

  return {
    display_phone_number: body?.display_phone_number ?? null,
    waba_id: body?.whatsapp_business_account_id ?? null,
  };
}

export type WhatsappSendResult = {
  ok: boolean;
  /** Meta accepted the submission (or this was a local dry-run). */
  dryRun?: boolean;
  status?: number;
  error?: string;
  providerMessageId?: string;
  providerPhoneNumberId?: string;
  trackingUncertain?: boolean;
  retryable?: boolean;
};

export type WhatsappTemplate = {
  name: string;
  language: string;
  bodyParameters?: string[];
};

export async function sendWhatsAppMessage(
  to: string,
  text: string,
  businessId?: string | null,
  options?: { allowDryRun?: boolean },
): Promise<WhatsappSendResult> {
  return sendWhatsAppPayload(to, { type: "text", text: { body: text } }, businessId, options);
}

export async function sendWhatsAppTemplate(
  to: string,
  template: WhatsappTemplate,
  businessId: string,
): Promise<WhatsappSendResult> {
  if (!/^[a-z0-9_]{1,512}$/.test(template.name)
    || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language)
    || (template.bodyParameters && (!Array.isArray(template.bodyParameters)
      || template.bodyParameters.length > 20
      || template.bodyParameters.some(value => typeof value !== "string" || value.length > 32768)))) {
    return { ok: false, error: DELIVERY_ERRORS.template, retryable: false };
  }
  return sendWhatsAppPayload(to, {
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(template.bodyParameters?.length ? {
        components: [{ type: "body", parameters: template.bodyParameters.map(text => ({ type: "text", text })) }],
      } : {}),
    },
  }, businessId);
}

async function sendWhatsAppPayload(
  to: string,
  payload: Record<string, unknown>,
  businessId?: string | null,
  options?: { allowDryRun?: boolean },
): Promise<WhatsappSendResult> {
  try {
    const creds = businessId ? await getWhatsappCredentials(businessId) : null;

    if (!creds) {
      if (options?.allowDryRun) {
        console.info("[whatsapp:dry-run] message queued", { toLength: to.length });
        return { ok: true, dryRun: true };
      }
      console.error("[whatsapp] No usable credentials", { businessId: businessId ?? "unknown" });
      return { ok: false, error: DELIVERY_ERRORS.connection };
    }

    const recipient = whatsappRecipientId(to);
    if (!recipient) return { ok: false, error: DELIVERY_ERRORS.recipient, retryable: false };
    if (recipient.includes(".") && process.env["WHATSAPP_BSUID_ENABLED"] !== "true") {
      return { ok: false, error: DELIVERY_ERRORS.bsuidUnavailable, retryable: false };
    }
    if (payload["type"] === "text"
      && !(await customerServiceWindowOpen(businessId!, creds.phoneNumberId, recipient))) {
      return { ok: false, error: DELIVERY_ERRORS.windowClosed, retryable: false };
    }

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          ...(recipient.includes(".") ? { recipient } : { to: recipient }),
          ...payload,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!res.ok) {
      // Provider response bodies can contain credentials or request details.
      // Persist and expose only fixed public messages, never arbitrary bodies.
      console.error("WhatsApp send failed", res.status);
      const publicError = deliveryErrorForStatus(res.status);
      if ((res.status === 401 || res.status === 403) && businessId) {
        await markConnectionInvalid(
          businessId,
          publicError,
        );
      }
      return {
        ok: false,
        status: res.status,
        error: publicError,
      };
    }

    const response = await res.json().catch(() => null);
    const providerMessageId = response?.messages?.[0]?.id;
    if (typeof providerMessageId !== "string" || !providerMessageId || providerMessageId.length > 512) {
      return { ok: true, status: res.status, providerPhoneNumberId: creds.phoneNumberId,
        trackingUncertain: true, error: DELIVERY_ERRORS.uncertain };
    }
    return { ok: true, status: res.status, providerMessageId, providerPhoneNumberId: creds.phoneNumberId };
  } catch (error) {
    console.error("WhatsApp send failed before confirmation");
    return { ok: false, error: DELIVERY_ERRORS.failed };
  }
}

