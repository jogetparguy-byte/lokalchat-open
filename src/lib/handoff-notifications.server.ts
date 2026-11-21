import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppTemplate } from "./whatsapp.server";
import { approvedWhatsAppTemplate } from "./whatsapp-window.server";
import { safeDeliveryError } from "./delivery-error";

/** Claims are durable; a stale external submission becomes uncertain rather than being resent. */
export async function processHandoffNotifications() {
  const { data, error } = await supabaseAdmin.rpc("claim_handoff_notifications");
  if (error) throw new Error("Amaran handoff belum dapat diproses.");
  let completed = 0;
  for (const row of data ?? []) {
    const finish = async (status: string, message: string | null = null, providerId: string | null = null, phoneId: string | null = null) => {
      const result = await supabaseAdmin.rpc("finish_handoff_notification", {
        p_id: row.id, p_token: row.lease_token!, p_status: status, p_error: message,
        p_provider_message_id: providerId, p_phone_number_id: phoneId,
      });
      if (result.error || !result.data) throw new Error("Status amaran handoff belum dapat disimpan.");
      completed++;
    };
    try {
      const { data: task, error: taskError } = await supabaseAdmin.from("handoff_tasks")
        .select("status").eq("id", row.task_id).eq("business_id", row.business_id).maybeSingle();
      if (taskError) throw new Error("Tugasan belum dapat disemak.");
      if (!task || task.status !== "pending") { await finish("skipped"); continue; }
      if (row.channel === "in_app") { await finish("published"); continue; }
      const { data: profile, error: profileError } = await supabaseAdmin.from("profiles")
        .select("handoff_notification_channel, owner_whatsapp").eq("id", row.business_id).maybeSingle();
      if (profileError) throw new Error("Pilihan amaran belum dapat disemak.");
      if (profile?.handoff_notification_channel !== "whatsapp") {
        await finish("skipped", "Amaran WhatsApp dimatikan oleh pemilik."); continue;
      }
      const template = await approvedWhatsAppTemplate(row.business_id, "handoff");
      if (!template || !profile.owner_whatsapp) {
        await finish("failed", "Amaran WhatsApp memerlukan nombor pemilik dan template handoff diluluskan."); continue;
      }
      const result = await sendWhatsAppTemplate(profile.owner_whatsapp, {
        ...template, bodyParameters: [
          row.stage === "escalation" ? "Tugasan bantuan pelanggan melebihi 15 minit tanpa penerimaan." : "Tugasan bantuan pelanggan baharu menunggu penerimaan.",
          row.task_id,
        ],
      }, row.business_id);
      if (result.ok) {
        await finish(result.providerMessageId ? "accepted" : "uncertain", result.providerMessageId ? null : "Meta menerima permintaan tetapi ID amaran belum disahkan. Semak sebelum cuba semula.",
          result.providerMessageId ?? null, result.providerPhoneNumberId ?? null);
      } else {
        const state = result.retryable === false ? "failed" : result.status === 429 || (result.status ?? 0) >= 500 ? "retry" : result.status ? "failed" : "uncertain";
        await finish(state, safeDeliveryError(result.error));
      }
    } catch {
      // No safe retry after an unknown side effect. Lease expiry exposes uncertainty for owner review.
      console.error("Handoff notification processing interrupted", { notificationId: row.id });
    }
  }
  return { claimed: data?.length ?? 0, completed };
}

const workerKey = Symbol.for("lokalchat.handoffNotifications");
export function startHandoffNotifications() {
  const state = globalThis as typeof globalThis & { [workerKey]?: boolean };
  if (state[workerKey]) return;
  state[workerKey] = true;
  const tick = async () => {
    try { await processHandoffNotifications(); }
    catch { console.error("Handoff notification sweep failed"); }
    finally { setTimeout(tick, 15_000).unref(); }
  };
  setTimeout(tick, 0).unref();
}
