import { usePreferences } from "@/components/lokalchat/usePreferences";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

export type ChatRow = {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  is_bot_active: boolean;
  last_message: string | null;
  updated_at: string;
};

export function ChatSidebar({
  chats,
  selectedId,
  onSelect,
}: {
  chats: ChatRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { translate: tr, formatDate } = usePreferences();
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{tr("Perbualan (")}{chats.length})
        </h2>
      </div>
      <ScrollArea className="flex-1">
        {chats.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{tr("Belum ada perbualan. Guna simulator di bawah untuk menguji bot. ")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {chats.map((chat) => {
              const needsHuman = !chat.is_bot_active;
              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    aria-current={selectedId === chat.id ? "true" : undefined}
                    onClick={() => onSelect(chat.id)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-sidebar-accent",
                      selectedId === chat.id && "bg-sidebar-accent",
                      needsHuman && "animate-flash-alert",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {chat.customer_name ?? chat.customer_phone}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatDate(chat.updated_at)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {chat.last_message ?? "—"}
                    </p>
                    {needsHuman && (
                      <span className="mt-2 inline-block rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-warning-foreground">{tr("⚠️ Human Action Required ")}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

