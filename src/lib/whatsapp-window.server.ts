import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function whatsappRecipientId(value: string): string | null {
  if (/^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/.test(value)) return value;
  const phone = value.replace(/[\s()+-]/g, "");
  return /^\d{7,20}$/.test(phone) ? phone : null;
}

export function providerEventTime(value: unknown, now = Date.now()): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const milliseconds = /^\d+(\.\d+)?$/.test(String(value))
    ? Number(value) * 1000
    : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > now) return null;
  return new Date(milliseconds).toISOString();
}

export function isCustomerServiceWindowOpen(timestamp: unknown, now = Date.now()): boolean {
  if (typeof timestamp !== "string") return false;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time <= now && now - time < CUSTOMER_SERVICE_WINDOW_MS;
}

/** Call only for a verified, durably recorded customer message, never a status receipt. */
export async function recordCustomerServiceEvent(
  businessId: string,
  recipient: string,
  timestamp: unknown,
  providerPhoneNumberId: string,
): Promise<boolean> {
  const recipientId = whatsappRecipientId(recipient);
  const eventTime = providerEventTime(timestamp);
  if (!recipientId || !eventTime || !providerPhoneNumberId) return false;
  const { data, error } = await supabaseAdmin.rpc("record_whatsapp_customer_event", {
    p_business_id: businessId,
    p_phone_number_id: providerPhoneNumberId,
    p_recipient_id: recipientId,
    p_provider_timestamp: eventTime,
  });
  if (error) throw new Error("Could not record WhatsApp customer service window");
  return data === true;
}

export async function customerServiceWindowOpen(
  businessId: string,
  phoneNumberId: string,
  recipient: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_service_windows")
      .select("last_customer_message_at")
      .eq("business_id", businessId)
      .eq("phone_number_id", phoneNumberId)
      .eq("recipient_id", recipient)
      .maybeSingle();
    return !error && isCustomerServiceWindowOpen(data?.last_customer_message_at);
  } catch {
    return false;
  }
}

/** Service-role configuration: the name/language must identify an approved Meta template. */
export async function approvedWhatsAppTemplate(businessId: string, purpose: "weekly_report" | "handoff"): Promise<{ name: string; language: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("internal_settings")
    .select("value")
    .eq("key", `whatsapp_${purpose}_template:${businessId}`)
    .maybeSingle();
  if (error || !data?.value) return null;
  try {
    const config = JSON.parse(data.value);
    if (config.approved !== true || typeof config.name !== "string" || !/^[a-z0-9_]{1,512}$/.test(config.name)
      || typeof config.language !== "string" || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(config.language)) return null;
    return { name: config.name, language: config.language };
  } catch {
    return null;
  }
}

export const weeklyReportTemplate = (businessId: string) => approvedWhatsAppTemplate(businessId, "weekly_report");
