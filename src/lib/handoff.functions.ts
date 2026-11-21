import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function taskId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("ID tugasan tidak sah.");
  return value;
}

export const listHandoffTasks = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: { resolved?: boolean }) => ({ resolved: input.resolved === true }))
  .handler(async ({ data, context }) => {
    const query = context.supabase.from("handoff_tasks")
      .select("id, chat_id, status, created_at, due_at, accepted_at, resolved_at")
      .eq("business_id", context.userId).order("created_at", { ascending: data.resolved ? false : true }).limit(100);
    const { data: tasks, error } = await (data.resolved ? query.eq("status", "resolved") : query.neq("status", "resolved"));
    if (error) throw new Error("Tugasan bantuan belum dapat dimuatkan.");
    if (!tasks?.length) return [];
    const { data: notifications, error: notificationError } = await context.supabase.from("handoff_notifications")
      .select("id, task_id, stage, channel, status, attempts, last_error, provider_delivery_status")
      .eq("business_id", context.userId).in("task_id", tasks.map(task => task.id));
    if (notificationError) throw new Error("Status amaran belum dapat dimuatkan.");
    return tasks.map(task => ({ ...task, notifications: (notifications ?? []).filter(notification => notification.task_id === task.id) }));
  });

export const getHandoffChat = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: { chatId: string }) => ({ chatId: taskId(input.chatId) }))
  .handler(async ({ data, context }) => {
    const { data: chat, error } = await context.supabase.from("chats")
      .select("id, customer_phone, customer_name, is_bot_active, last_message, updated_at")
      .eq("business_id", context.userId).eq("id", data.chatId).maybeSingle();
    if (error) throw new Error("Perbualan tugasan gagal dimuatkan.");
    return chat;
  });

export const transitionHandoffTask = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: { taskId: string; expectedStatus: "pending" | "accepted"; status: "accepted" | "resolved" }) => {
    if (!((input.expectedStatus === "pending" && input.status === "accepted") || (input.expectedStatus === "accepted" && input.status === "resolved"))) throw new Error("Perubahan tugasan tidak sah.");
    return { ...input, taskId: taskId(input.taskId) };
  }).handler(async ({ data, context }) => {
    const { data: changed, error } = await context.supabase.rpc("transition_handoff_task", {
      p_task_id: data.taskId, p_expected_status: data.expectedStatus, p_status: data.status,
    });
    if (error) throw new Error("Tugasan gagal dikemas kini.");
    if (!changed) throw new Error("Tugasan telah berubah atau tidak tersedia. Muat semula senarai.");
    return { ok: true };
  });

export const retryHandoffNotification = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: { notificationId: string }) => ({ notificationId: taskId(input.notificationId) }))
  .handler(async ({ data, context }) => {
    const { data: changed, error } = await context.supabase.rpc("retry_handoff_notification", { p_id: data.notificationId });
    if (error || !changed) throw new Error("Amaran tidak dapat dicuba semula. Muat semula status tugasan.");
    return { ok: true };
  });

export const getHandoffSettings = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("profiles")
      .select("handoff_notification_channel, owner_whatsapp").eq("id", context.userId).maybeSingle();
    if (error || !data) throw new Error("Pilihan amaran belum tersedia.");
    return data;
  });

export const setHandoffChannel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: { channel: "in_app" | "whatsapp" }) => {
    if (!["in_app", "whatsapp"].includes(input.channel)) throw new Error("Saluran amaran tidak sah.");
    return input;
  }).handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("profiles").update({ handoff_notification_channel: data.channel }).eq("id", context.userId);
    if (error) throw new Error("Pilihan amaran gagal disimpan.");
    return { ok: true };
  });
