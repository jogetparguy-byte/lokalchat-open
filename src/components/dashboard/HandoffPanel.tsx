import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePreferences } from "@/components/lokalchat/usePreferences";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { safeDeliveryError } from "@/lib/delivery-error";
import {
  getHandoffSettings,
  listHandoffTasks,
  retryHandoffNotification,
  setHandoffChannel,
  transitionHandoffTask,
  useApi,
} from "@/services/api";
import type { ChatRow } from "./ChatSidebar";

type HandoffTask = Awaited<ReturnType<typeof listHandoffTasks>>[number];
type Notification = HandoffTask["notifications"][number];
type Channel = Parameters<typeof setHandoffChannel>[0]["data"]["channel"];
type HandoffAction =
  | { kind: "transition"; data: Parameters<typeof transitionHandoffTask>[0]["data"] }
  | { kind: "retry"; notificationId: string }
  | { kind: "channel"; channel: Channel };

export function HandoffPanel({ chats, onOpenChat }: {
  chats: ChatRow[];
  onOpenChat: (chatId: string) => void;
}) {
  const { t, formatDate } = usePreferences();
  const [resolved, setResolved] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const lock = useRef(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const queryClient = useQueryClient();
  const fetchTasks = useApi(listHandoffTasks);
  const fetchSettings = useApi(getHandoffSettings);
  const changeTask = useApi(transitionHandoffTask);
  const retryNotification = useApi(retryHandoffNotification);
  const updateChannel = useApi(setHandoffChannel);
  const tasks = useQuery({
    queryKey: ["handoff-tasks", resolved],
    queryFn: () => fetchTasks({ data: { resolved } }),
    refetchInterval: 5000,
    retry: 1,
  });
  const settings = useQuery({
    queryKey: ["handoff-settings"],
    queryFn: () => fetchSettings(),
    retry: 1,
  });
  const action = useMutation({
    mutationFn: (input: HandoffAction) => {
      switch (input.kind) {
        case "transition": return changeTask({ data: input.data });
        case "retry": return retryNotification({ data: { notificationId: input.notificationId } });
        case "channel": return updateChannel({ data: { channel: input.channel } });
      }
    },
    onSuccess: (_data, input) => {
      const text = input.kind === "retry"
        ? t("Amaran dimasukkan semula ke giliran.", "Notification queued for retry.")
        : input.kind === "channel"
          ? t("Saluran amaran disimpan.", "Notification channel saved.")
          : input.data.status === "accepted"
            ? t("Tugasan diterima.", "Task accepted.")
            : t("Tugasan selesai.", "Task resolved.");
      setFeedback({ error: false, text });
    },
    onError: (_error, input) => {
      const text = input.kind === "retry"
        ? t("Amaran gagal dimasukkan ke giliran. Semak status terkini.", "Could not queue the retry. Check the latest status.")
        : input.kind === "channel"
          ? t("Saluran amaran gagal disimpan. Cuba lagi.", "Could not save the notification channel. Try again.")
          : t("Tugasan gagal dikemas kini. Semak status terkini.", "Could not update the task. Check the latest status.");
      setFeedback({ error: true, text });
    },
    onSettled: async (_data, _error, input) => {
      try {
        await queryClient.invalidateQueries({
          queryKey: input.kind === "channel" ? ["handoff-settings"] : ["handoff-tasks"],
        });
      } finally {
        lock.current = false;
      }
    },
    retry: false,
  });
  const runAction = (input: HandoffAction) => {
    if (lock.current) return;
    lock.current = true;
    setFeedback(null);
    action.mutate(input);
  };
  useEffect(() => {
    if (feedback && document.activeElement === document.body) feedbackRef.current?.focus();
  }, [feedback, action.isPending]);

  const hasRecipient = Boolean(settings.data?.owner_whatsapp?.trim());
  const channel = settings.data?.handoff_notification_channel === "whatsapp" ? "whatsapp" : "in_app";

  return (
    <section aria-labelledby="handoff-heading" className="mb-4 min-w-0 rounded-xl border border-border">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div>
          <h2 id="handoff-heading" className="text-base font-semibold">{t("Tugasan handoff", "Handoff tasks")}</h2>
          <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={t("Paparan tugasan", "Task view")}>
            <Button type="button" variant={resolved ? "ghost" : "secondary"} aria-pressed={!resolved} onClick={() => setResolved(false)}>
              {t("Terbuka", "Open")}
            </Button>
            <Button type="button" variant={resolved ? "secondary" : "ghost"} aria-pressed={resolved} onClick={() => setResolved(true)}>
              {t("Selesai", "Resolved")}
            </Button>
          </div>
        </div>
        <div className="w-full min-w-0 space-y-1 sm:max-w-64">
          {settings.isPending && <p role="status" className="text-sm">{t("Memuatkan saluran amaran…", "Loading notification channel…")}</p>}
          {settings.isError && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="text-sm">{t("Saluran amaran gagal dimuatkan.", "Could not load the notification channel.")}</p>
              <Button type="button" variant="outline" onClick={() => void settings.refetch()}>{t("Muat semula saluran", "Reload channel")}</Button>
            </div>
          )}
          {settings.isSuccess && (
            <>
              <Label htmlFor="handoff-channel">{t("Saluran amaran baharu", "Channel for new notifications")}</Label>
              <select
                id="handoff-channel"
                aria-describedby="handoff-channel-hint"
                className="h-10 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                value={action.isPending && action.variables.kind === "channel" ? action.variables.channel : channel}
                disabled={action.isPending}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "in_app" || (value === "whatsapp" && hasRecipient)) runAction({ kind: "channel", channel: value });
                }}
              >
                <option value="in_app">{t("Dalam Inbox", "In Inbox")}</option>
                <option value="whatsapp" disabled={!hasRecipient}>WhatsApp</option>
              </select>
              <p id="handoff-channel-hint" className="text-sm text-muted-foreground">
                {hasRecipient
                  ? t("WhatsApp memerlukan sambungan aktif dan templat handoff yang diluluskan.", "WhatsApp requires an active connection and an approved handoff template.")
                  : t("Tambah nombor WhatsApp pemilik dalam Tetapan untuk memilih WhatsApp.", "Add the owner's WhatsApp number in Settings to select WhatsApp.")}
              </p>
            </>
          )}
        </div>
      </header>
      {feedback && (
        <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? "alert" : "status"} className="mx-4 mb-3 text-sm">
          {feedback.text}
        </p>
      )}
      <div className="min-h-12 border-t border-border">
        {tasks.isPending && <p role="status" className="px-4 py-3 text-sm">{t("Memuatkan tugasan…", "Loading tasks…")}</p>}
        {tasks.isError && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <p role="alert" className="text-sm">{t("Tugasan gagal dimuatkan.", "Could not load tasks.")}</p>
            <Button type="button" variant="outline" onClick={() => void tasks.refetch()}>{t("Muat semula tugasan", "Reload tasks")}</Button>
          </div>
        )}
        {tasks.isSuccess && tasks.data.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {resolved ? t("Tiada tugasan selesai.", "No resolved tasks.") : t("Tiada tugasan terbuka.", "No open tasks.")}
          </p>
        )}
        {tasks.isSuccess && tasks.data.length > 0 && (
          <ul aria-label={resolved ? t("Tugasan selesai", "Resolved tasks") : t("Tugasan terbuka", "Open tasks")}
            tabIndex={0} className="max-h-72 divide-y divide-border overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            {tasks.data.map((task) => {
              const chat = chats.find((row) => row.id === task.chat_id);
              const customer = chat?.customer_name || chat?.customer_phone || task.chat_id;
              const overdue = task.status === "pending" && Date.parse(task.due_at) <= tasks.dataUpdatedAt;
              const status = task.status === "resolved" ? t("Selesai", "Resolved")
                : task.status === "accepted" ? t("Diterima", "Accepted")
                  : overdue ? t("Lewat", "Overdue") : t("Menunggu penerimaan", "Awaiting acceptance");
              const timestamp = task.resolved_at ?? task.accepted_at ?? task.due_at;
              const timeLabel = task.resolved_at ? t("Selesai pada", "Resolved at")
                : task.accepted_at ? t("Diterima pada", "Accepted at") : t("Terima sebelum", "Accept by");
              return (
                <li key={task.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <h3 className="break-words text-sm font-semibold">{customer}</h3>
                      <p className="text-sm">
                        <span className={overdue ? "font-semibold" : undefined}>{status}</span>
                        {" · "}{timeLabel} <time dateTime={timestamp}>{formatDate(timestamp)}</time>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => onOpenChat(task.chat_id)}>
                        {t("Buka perbualan", "Open chat")}
                      </Button>
                      {task.status === "pending" && (
                        <Button type="button" disabled={action.isPending} onClick={() => runAction({
                          kind: "transition", data: { taskId: task.id, expectedStatus: "pending", status: "accepted" },
                        })}>{t("Terima tugasan", "Accept task")}</Button>
                      )}
                      {task.status === "accepted" && (
                        <Button type="button" disabled={action.isPending} onClick={() => runAction({
                          kind: "transition", data: { taskId: task.id, expectedStatus: "accepted", status: "resolved" },
                        })}>{t("Selesaikan tugasan", "Resolve task")}</Button>
                      )}
                    </div>
                  </div>
                  {task.notifications.length > 0 && (
                    <ul className="space-y-1 pl-3">
                      {[...task.notifications].sort((a, b) => b.stage.localeCompare(a.stage)).map((notification) => (
                        <NotificationRow key={notification.id} notification={notification}
                          canRetry={task.status === "pending"} busy={action.isPending}
                          onRetry={() => runAction({ kind: "retry", notificationId: notification.id })} />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function NotificationRow({ notification, canRetry, busy, onRetry }: {
  notification: Notification;
  canRetry: boolean;
  busy: boolean;
  onRetry: () => void;
}) {
  const { t, translate } = usePreferences();
  const stage = notification.stage === "escalation" ? t("Susulan", "Reminder") : t("Amaran awal", "Initial alert");
  const channel = notification.channel === "whatsapp" ? "WhatsApp" : t("Dalam Inbox", "In Inbox");
  const statuses: Record<string, string> = {
    pending: t("Dalam giliran", "Queued"),
    sending: t("Sedang dihantar", "Sending"),
    retry: t("Menunggu cubaan automatik", "Waiting for automatic retry"),
    published: t("Dipaparkan dalam Inbox", "Published in Inbox"),
    accepted: t("Diterima Meta", "Accepted by Meta"),
    failed: t("Penghantaran gagal", "Delivery failed"),
    uncertain: t("Penghantaran belum disahkan", "Delivery unconfirmed"),
    skipped: t("Tidak dihantar", "Skipped"),
  };
  const providerStatuses: Record<string, string> = {
    delivered: t("Sampai ke WhatsApp penerima", "Delivered to recipient's WhatsApp"),
    read: t("Dibaca di WhatsApp", "Read on WhatsApp"),
  };
  const status = (notification.status === "accepted" && notification.provider_delivery_status
    ? providerStatuses[notification.provider_delivery_status] : undefined)
    ?? statuses[notification.status] ?? t("Status tidak diketahui", "Unknown status");
  const uncertain = notification.status === "uncertain";
  const failed = notification.status === "failed";
  const safeError = notification.last_error === "Amaran WhatsApp memerlukan nombor pemilik dan template handoff diluluskan."
    ? t("Semak nombor WhatsApp pemilik dan templat handoff yang diluluskan.", "Check the owner's WhatsApp number and the approved handoff template.")
    : translate(safeDeliveryError(notification.last_error) ?? "");

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <p className="min-w-0 break-words">
        <span className="text-muted-foreground">{stage} · {channel} · </span>
        <span className={uncertain || failed ? "font-semibold" : undefined}>{status}</span>
        {failed && safeError && <>. {safeError}</>}
      </p>
      {canRetry && (failed || uncertain) && (
        uncertain ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={busy}>{t("Cuba semula amaran", "Retry notification")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="w-[calc(100%_-_2rem)] rounded-lg motion-reduce:animate-none">
              <AlertDialogHeader>
                <AlertDialogTitle>{t("Cuba semula amaran WhatsApp?", "Retry WhatsApp notification?")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("Meta mungkin sudah menerima amaran ini. Semak WhatsApp terlebih dahulu. Mengulang penghantaran boleh menghasilkan amaran pendua.",
                    "Meta may have already accepted this notification. Check WhatsApp first. Retrying may send a duplicate.")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2 sm:space-x-0">
                <AlertDialogCancel>{t("Batal", "Cancel")}</AlertDialogCancel>
                <AlertDialogAction disabled={busy} onClick={onRetry}>{t("Sahkan cubaan semula", "Confirm retry")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button type="button" variant="outline" disabled={busy} onClick={onRetry}>{t("Cuba semula amaran", "Retry notification")}</Button>
        )
      )}
    </li>
  );
}
