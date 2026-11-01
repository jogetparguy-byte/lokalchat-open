import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatRow } from "./ChatSidebar";

export type MessageRow = {
  id: string;
  chat_id: string;
  sender: "customer" | "bot" | "human" | "system";
  text: string;
  created_at: string;
  delivery_status: "pending" | "sending" | "sent" | "failed" | null;
  last_delivery_error: string | null;
  sent_at: string | null;
  delivery_attempts: number | null;
};

export const deliveryLabels = {
  pending: "Menunggu penghantaran",
  sending: "Sedang dihantar",
  sent: "Diterima Meta",
  failed: "Penghantaran gagal",
} as const;

export function ChatWindow({ chat, messages, onToggleBot, onSend, onRetry, sending, toggling, retryingId, loading, error }: {
  chat: ChatRow | null;
  messages: MessageRow[];
  onToggleBot: (isActive: boolean) => void;
  onSend: (text: string, requestId: string) => Promise<unknown>;
  onRetry: (messageId: string) => void;
  sending: boolean;
  toggling: boolean;
  retryingId: string | null;
  loading: boolean;
  error?: string | null;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [uncertainDrafts, setUncertainDrafts] = useState<Record<string, string>>({});
  const submittingRef = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, chat?.id]);
  if (!chat) return <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">Pilih satu perbualan untuk mula.</div>;
  const draft = drafts[chat.id] ?? "";
  const uncertain = uncertainDrafts[chat.id] === draft.trim();
  return (
    <div className="flex h-full min-h-[30rem] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div><p className="font-semibold">{chat.customer_name ?? chat.customer_phone}</p><p className="text-xs text-muted-foreground">{chat.customer_phone}</p></div>
        <div className="flex items-center gap-3">
          <Label htmlFor="bot-toggle" className="text-xs font-semibold">{chat.is_bot_active ? "Bot aktif" : "Anda mengambil alih"}</Label>
          <Switch id="bot-toggle" checked={chat.is_bot_active} disabled={toggling} onCheckedChange={onToggleBot} />
        </div>
      </div>
      {error && <p role="alert" className="border-b border-border p-3 text-sm text-destructive">{error}</p>}
      <ScrollArea className="h-[28rem] flex-1 bg-muted/40 px-4 py-4">
        {loading ? <p role="status" className="text-sm text-muted-foreground">Memuatkan mesej…</p> : messages.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada mesej.</p> : null}
        <div className="space-y-3">
          {messages.map((message) => {
            if (message.sender === "system") return <p key={message.id} className="mx-auto w-fit rounded-full bg-secondary px-3 py-1 text-center text-[11px] text-secondary-foreground">{message.text}</p>;
            const isCustomer = message.sender === "customer";
            const status = !isCustomer ? message.delivery_status : null;
            return (
              <div key={message.id} className={cn("flex", isCustomer ? "justify-start" : "justify-end")}>
                <div className={cn("max-w-[85%] break-words rounded-2xl px-3.5 py-2 text-sm shadow-sm", isCustomer && "bg-bubble-customer text-bubble-customer-foreground", message.sender === "bot" && "bg-bubble-bot text-bubble-bot-foreground", message.sender === "human" && "bg-bubble-human text-bubble-human-foreground")}>
                  <span className="mb-0.5 block text-[10px] uppercase tracking-wide opacity-70">{message.sender}</span>
                  <span className="whitespace-pre-wrap">{message.text}</span>
                  {status && <div className="mt-2 border-t border-current/20 pt-1 text-xs">
                    <span className={cn("inline-block rounded px-1.5 py-0.5 font-medium", status === "failed" ? "bg-destructive text-destructive-foreground" : "bg-background/70 text-foreground")}>{deliveryLabels[status]}</span>
                    {status === "sent" && <p className="mt-1 opacity-80">Belum mengesahkan diterima atau dibaca pelanggan.</p>}
                    {status === "failed" && message.last_delivery_error && <p className="mt-1">Penghantaran tidak berjaya. Semak sambungan WhatsApp anda dan cuba semula.</p>}
                    {message.delivery_attempts != null && <p className="mt-1 opacity-70">Cubaan: {message.delivery_attempts}</p>}
                    {status === "failed" && message.sender === "human" && <Button type="button" size="sm" variant="outline" className="mt-2 text-foreground" disabled={retryingId !== null || sending} onClick={() => onRetry(message.id)}>{retryingId === message.id ? "Mencuba semula…" : "Cuba Semula"}</Button>}
                  </div>}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      {uncertain && <p role="alert" className="border-t border-border p-3 text-xs text-destructive">Penghantaran belum disahkan. Draf dikekalkan. Semak & cuba semula menggunakan ID permintaan yang sama.</p>}
      <form className="flex gap-2 border-t border-border p-3" onSubmit={async (event) => {
        event.preventDefault();
        const text = draft.trim();
        if (!text || text.length > 2000 || sending || retryingId !== null || submittingRef.current) return;
        const chatId = chat.id;
        submittingRef.current = true;
        try {
          const requestKey = `${chatId}:${text}`;
          const requestId = requestIds.current.get(requestKey) ?? crypto.randomUUID();
          requestIds.current.set(requestKey, requestId);
          await onSend(text, requestId);
          requestIds.current.delete(requestKey);
          setDrafts(current => ({ ...current, [chatId]: "" }));
          setUncertainDrafts(current => { const next = { ...current }; delete next[chatId]; return next; });
        } catch {
          // A failed request can still have persisted a message. Keep the draft
          // and reuse the request ID when the owner submits it again.
          setUncertainDrafts(current => ({ ...current, [chatId]: text }));
        } finally { submittingRef.current = false; }
      }}>
        <Input aria-label="Balasan pelanggan" value={draft} maxLength={2000} disabled={sending} onChange={event => setDrafts(current => ({ ...current, [chat.id]: event.target.value }))} placeholder={chat.is_bot_active ? "Balas manual (bot masih aktif)…" : "Taip balasan anda…"} />
        <Button type="submit" disabled={sending || retryingId !== null || !draft.trim()}>{sending ? "Menghantar…" : uncertain ? "Semak & cuba semula" : "Hantar"}</Button>
      </form>
    </div>
  );
}
