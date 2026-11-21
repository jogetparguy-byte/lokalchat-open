import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { providerDeliveryFailure } from "./delivery-error";

type DeliveryClient = Pick<SupabaseClient<Database>, "rpc">;
type AcceptedSend = { providerMessageId?: string; providerPhoneNumberId?: string };

/** Bind API acceptance to its durable message before webhook reconciliation. */
export async function recordWhatsAppAcceptance(
  supabase: DeliveryClient, userId: string, messageId: string, result: AcceptedSend,
): Promise<boolean> {
  if (!result.providerMessageId) return false;
  if (!result.providerPhoneNumberId) throw new Error("Provider phone identity missing after acceptance");
  const { error } = await supabase.rpc("register_whatsapp_acceptance", {
    p_business_id: userId, p_message_id: messageId,
    p_phone_number_id: result.providerPhoneNumberId, p_provider_message_id: result.providerMessageId,
  });
  if (error) throw new Error("Status penghantaran belum dapat disahkan; jangan hantar semula mesej ini.");
  return true;
}

/** Called only after the webhook signature and phone/account binding are verified. */
export async function processWhatsAppStatuses(input: {
  supabase: DeliveryClient; userId: string; phoneNumberId: string; statuses: unknown;
}): Promise<void> {
  if (!Array.isArray(input.statuses)) return;
  for (const raw of input.statuses) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as Record<string, unknown>;
    if (typeof event["id"] !== "string" || !event["id"] || event["id"].length > 512) continue;
    if (!["sent", "delivered", "read", "failed"].includes(String(event["status"]))) continue;
    if (typeof event["timestamp"] !== "string" || !/^\d{1,12}$/.test(event["timestamp"])) continue;
    const milliseconds = Number(event["timestamp"]) * 1000;
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 8640000000000000) continue;
    // Provider error text can contain arbitrary payload details. Persist only numeric codes.
    const codes = Array.isArray(event["errors"]) ? event["errors"].flatMap((error: unknown) => {
      if (!error || typeof error !== "object") return [];
      const code = (error as Record<string, unknown>)["code"];
      return typeof code === "number" && Number.isSafeInteger(code) ? [code] : [];
    }).slice(0, 10) : [];
    const { error } = await input.supabase.rpc("record_whatsapp_delivery_status", {
      p_business_id: input.userId, p_phone_number_id: input.phoneNumberId,
      p_provider_message_id: event["id"], p_status: String(event["status"]),
      p_occurred_at: new Date(milliseconds).toISOString(),
      p_error: event["status"] === "failed" ? providerDeliveryFailure(codes) : null,
    });
    if (error) throw new Error("Failed to persist WhatsApp delivery status");
  }
}

/** Weekly report recipients do not necessarily have an Inbox chat. */
export async function recordWhatsAppReportAcceptance(supabase: DeliveryClient, userId: string, result: AcceptedSend): Promise<boolean> {
  if (!result.providerMessageId) return false;
  if (!result.providerPhoneNumberId) throw new Error("Provider phone identity missing after acceptance");
  const { error } = await supabase.rpc("register_whatsapp_report_acceptance", {
    p_business_id: userId, p_phone_number_id: result.providerPhoneNumberId, p_provider_message_id: result.providerMessageId,
  });
  if (error) throw new Error("Status laporan belum dapat disahkan; jangan hantar semula laporan ini.");
  return true;
}
