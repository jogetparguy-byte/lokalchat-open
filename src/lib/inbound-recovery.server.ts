import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ingestCustomerMessage } from "./agent.server";

/** One bounded sweep. SQL eligibility and the atomic inbound claim handle competing servers. */
export async function recoverInboundMessages() {
  const { data, error } = await supabaseAdmin.rpc("list_recoverable_inbound_messages");
  if (error) throw new Error(`Inbound recovery unavailable: ${error.message}`);
  let failed = 0;
  for (const row of data ?? []) {
    try {
      await ingestCustomerMessage({
        businessId: row.business_id, customerPhone: row.customer_phone,
        text: row.text, messageId: row.external_message_id, resumeChatId: row.chat_id,
        allowDryRun: row.allow_dry_run,
      });
    } catch {
      failed++;
      console.error("Inbound recovery attempt failed", { messageId: row.id });
    }
  }
  return { scanned: data?.length ?? 0, failed };
}

const workerKey = Symbol.for("lokalchat.inboundRecovery");
export function startInboundRecovery() {
  const state = globalThis as typeof globalThis & { [workerKey]?: boolean };
  if (state[workerKey]) return;
  state[workerKey] = true;
  const tick = async () => {
    try { await recoverInboundMessages(); }
    catch (error) { console.error("Inbound recovery sweep failed", error); }
    finally { setTimeout(tick, 15_000).unref(); }
  };
  setTimeout(tick, 0).unref();
}
