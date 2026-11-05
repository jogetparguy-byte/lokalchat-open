import { usePreferences } from "@/components/lokalchat/usePreferences";
import { createFileRoute } from "@tanstack/react-router";
import { ConsoleShell } from "@/components/lokalchat/ConsoleShell";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChatSidebar, type ChatRow } from "@/components/dashboard/ChatSidebar";
import { ChatWindow, type MessageRow } from "@/components/dashboard/ChatWindow";
import {
  listChats,
  listMessages,
  setBotActive,
  sendHumanReply,
  retryFailedHumanReply,
  simulateIncoming,
} from "@/services/api";

export const Route = createFileRoute("/_authenticated/dashboard_/inbox")({
  component: DashboardPage,
  validateSearch: (search: Record<string, unknown>): { chat?: string } =>
    typeof search["chat"] === "string" ? { chat: search["chat"] as string } : {},
  head: () => ({
    meta: [
      { title: "Dashboard — LokalChat" },
      {
        name: "description",
        content: "Urus perbualan WhatsApp dan FAQ kedai anda.",
      },
      { property: "og:title", content: "Dashboard — LokalChat" },
      {
        property: "og:description",
        content: "Urus perbualan WhatsApp dan FAQ kedai anda.",
      },
    ],
    links: [{ rel: "canonical", href: "/dashboard/inbox" }],
  }),
});

export function DashboardPage() {
  const { translate: tr } = usePreferences();
  const queryClient = useQueryClient();
  const { chat: initialChat } = Route.useSearch();
  const [selectedId, setSelectedId] = useState<string | null>(initialChat ?? null);

  const [actionError, setActionError] = useState<{ chatId: string; text: string } | null>(null);
  const retryLock = useRef(false);
  const fetchChats = useApi(listChats);
  const fetchMessages = useApi(listMessages);
  const toggleBot = useApi(setBotActive);
  const sendReply = useApi(sendHumanReply);
  const retryReply = useApi(retryFailedHumanReply);
  const simulate = useApi(simulateIncoming);
  useEffect(() => { if (initialChat) setSelectedId(initialChat); }, [initialChat]);

  const refresh = async (chatId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chats"] }),
      queryClient.invalidateQueries({ queryKey: chatId ? ["messages", chatId] : ["messages"] }),
    ]);
  };
  const chatsQuery = useQuery({ queryKey: ["chats"], queryFn: () => fetchChats(), refetchInterval: 5000, retry: 1 });
  const messagesQuery = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => selectedId ? fetchMessages({ data: { chatId: selectedId } }) : [],
    enabled: !!selectedId, refetchInterval: 5000, retry: 1,
  });
  const toggleMutation = useMutation({
    mutationFn: ({ chatId, isActive }: { chatId: string; isActive: boolean }) => toggleBot({ data: { chatId, isActive } }),
    onMutate: () => setActionError(null),
    onError: (_error, variables) => setActionError({ chatId: variables.chatId, text: tr("Status bot gagal dikemas kini. Cuba lagi.") }),
    onSettled: (_data, _error, variables) => refresh(variables.chatId),
    retry: false,
  });
  const replyMutation = useMutation({
    mutationFn: ({ chatId, text, requestId }: { chatId: string; text: string; requestId: string }) => sendReply({ data: { chatId, text, requestId } }),
    onMutate: () => setActionError(null),
    onSuccess: (result, variables) => {
      if (!result.ok) setActionError({ chatId: variables.chatId, text: tr("Mesej disimpan tetapi penghantaran gagal. Tekan Cuba Semula pada mesej tersebut.") });
    },
    onError: (_error, variables) => setActionError({ chatId: variables.chatId, text: tr("Permintaan penghantaran gagal. Semak mesej tersimpan sebelum menghantar lagi.") }),
    onSettled: (_data, _error, variables) => refresh(variables.chatId),
    retry: false,
  });
  const retryMutation = useMutation({
    mutationFn: ({ messageId }: { messageId: string; chatId: string }) => retryReply({ data: { messageId } }),
    onMutate: () => setActionError(null),
    onError: (_error, variables) => setActionError({ chatId: variables.chatId, text: tr("Penghantaran semula gagal. Status terkini dimuat semula; tekan Cuba Semula jika mesej masih gagal.") }),
    onSettled: async (_data, _error, variables) => { try { await refresh(variables.chatId); } finally { retryLock.current = false; } },
    retry: false,
  });
  const simulateMutation = useMutation({
    mutationFn: ({ phone, text }: { phone: string; text: string }) => simulate({ data: { phone, text } }),
    onSuccess: () => refresh(),
    retry: false,
  });

  const selectedChat =
    (chatsQuery.data ?? []).find((chat) => chat.id === selectedId) ?? null;

  return (
    <ConsoleShell>
      <div className="lc-topbar">
        <div>
          <h1>Live Chat</h1>
          <p>{tr("Urus perbualan WhatsApp pelanggan anda")}</p>
        </div>
      </div>

      {chatsQuery.isPending && <p role="status" className="mb-3 text-sm">{tr("Memuatkan perbualan…")}</p>}
      {chatsQuery.isError && <div role="alert" className="mb-3 text-sm text-destructive">{tr("Perbualan gagal dimuatkan. ")}<Button variant="outline" size="sm" onClick={() => chatsQuery.refetch()}>{tr("Cuba lagi")}</Button></div>}
      <div className="flex min-h-[32rem] flex-col md:flex-row flex-1 overflow-hidden rounded-xl border border-border">
        <aside className="max-h-64 w-full border-b border-border md:max-h-none md:max-w-xs md:border-b-0 md:border-r">
          <ChatSidebar
            chats={(chatsQuery.data ?? []) as ChatRow[]}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <ChatWindow
            chat={selectedChat as ChatRow | null}
            messages={(messagesQuery.data ?? []) as MessageRow[]}
            onToggleBot={(isActive) =>
              selectedId && toggleMutation.mutate({ chatId: selectedId, isActive })
            }
            onSend={(text, requestId) => {
              if (!selectedId) return Promise.reject(new Error(tr("Pilih perbualan dahulu")));
              return replyMutation.mutateAsync({ chatId: selectedId, text, requestId });
            }}
            onRetry={(messageId) => {
              if (!selectedId || retryLock.current || replyMutation.isPending) return;
              const message = messagesQuery.data?.find((row) => row.id === messageId);
              if (!message || message.chat_id !== selectedId || message.sender !== "human" || message.delivery_status !== "failed") return;
              retryLock.current = true;
              retryMutation.mutate({ messageId, chatId: selectedId });
            }}
            retryingId={retryMutation.isPending ? retryMutation.variables.messageId : null}
            toggling={toggleMutation.isPending}
            loading={messagesQuery.isPending}
            error={messagesQuery.isError ? tr("Mesej gagal dimuatkan. Sistem akan cuba memuatkan semula.") : actionError?.chatId === selectedId ? actionError.text : null}
            sending={replyMutation.isPending}
          />
        </main>
      </div>

      <div className="mt-4 rounded-xl border border-border p-3">
        <p className="mb-3 text-xs text-muted-foreground">{tr("Simulator menggunakan AI dan data kedai sebenar. Mesej direkod dalam inbox; tiada WhatsApp dihantar.")}</p>
        {simulateMutation.isError && <p role="alert" className="mb-2 text-sm text-destructive">{tr("Simulasi gagal. Semak konfigurasi AI kedai.")}</p>}
        <SimulatorForm
          onSimulate={(phone, text) =>
            simulateMutation.mutate({ phone, text })
          }
          loading={simulateMutation.isPending}
        />
      </div>
    </ConsoleShell>
  );
}

function SimulatorForm({
  onSimulate,
  loading,
}: {
  onSimulate: (phone: string, text: string) => void;
  loading: boolean;
}) {
  const { translate: tr } = usePreferences();
  const [phone, setPhone] = useState("+60123456789");
  const [text, setText] = useState(tr("Ada stok tak?"));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!loading && phone.trim() && text.trim()) onSimulate(phone.trim(), text.trim());
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="min-w-[12rem] flex-1">
        <Label htmlFor="sim-phone" className="text-xs">{tr("Nombor telefon ")}</Label>
        <Input
          id="sim-phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      <div className="min-w-[16rem] flex-[2]">
        <Label htmlFor="sim-text" className="text-xs">{tr("Mesej pelanggan ")}</Label>
        <Input
          id="sim-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading || !phone.trim() || !text.trim()}>{tr("Simulasi ")}</Button>
    </form>
  );
}

