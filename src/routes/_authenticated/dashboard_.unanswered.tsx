import { usePreferences } from "@/components/lokalchat/usePreferences";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/services/api";
import { toast } from "sonner";
import { ConsoleShell } from "@/components/lokalchat/ConsoleShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dismissUnansweredQuestion,
  getUnansweredQuestionDetail,
  listUnansweredQuestions,
  resolveUnansweredWithFaq,
} from "@/services/api";

export const Route = createFileRoute("/_authenticated/dashboard_/unanswered")({
  component: UnansweredPage,
  head: () => ({
    meta: [
      { title: "Soalan Tidak Dijawab — LokalChat" },
      { name: "description", content: "Soalan pelanggan yang bot tidak dapat jawab, untuk ditambah ke FAQ." },
      { property: "og:title", content: "Soalan Tidak Dijawab — LokalChat" },
      { property: "og:description", content: "Soalan pelanggan yang bot tidak dapat jawab, untuk ditambah ke FAQ." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Sort = "most_asked" | "newest" | "oldest";
type Status = "all" | "unanswered" | "resolved" | "dismissed";

const STATUS_LABEL: Record<string, string> = {
  unanswered: "Belum dijawab",
  resolved: "Selesai",
  dismissed: "Diabaikan",
};

function StatusBadge({ status }: { status: string }) {
  const { translate: tr, formatDate } = usePreferences();
  const variant = status === "unanswered" ? "destructive" : status === "resolved" ? "default" : "secondary";
  return <Badge variant={variant}>{tr(STATUS_LABEL[status] ?? status)}</Badge>;
}

function UnansweredPage() {
  const { translate: tr, formatDate } = usePreferences();
  const qc = useQueryClient();
  const [sort, setSort] = useState<Sort>("most_asked");
  const [status, setStatus] = useState<Status>("unanswered");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [faqFor, setFaqFor] = useState<{ id: string; question: string } | null>(null);

  const list = useApi(listUnansweredQuestions);
  const dismiss = useApi(dismissUnansweredQuestion);

  const query = useQuery({
    queryKey: ["unanswered", sort, status],
    queryFn: () => list({ data: { sort, status } }),
  });

  const dismissMut = useMutation({
    mutationFn: (id: string) => dismiss({ data: { id } }),
    onSuccess: () => {
      toast.success(tr("Soalan diabaikan"));
      qc.invalidateQueries({ queryKey: ["unanswered"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = query.data ?? [];
  const detail = rows.find((r) => r.id === detailId) ?? null;

  return (
    <ConsoleShell>
      <div className="lc-topbar">
        <div>
          <h1>{tr("Soalan Tidak Dijawab")}</h1>
          <p>{tr("Soalan pelanggan yang bot tidak pasti jawapannya. Tambah ke FAQ supaya bot boleh jawab lain kali.")}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-44">
          <Label className="text-xs">{tr("Susun")}</Label>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="most_asked">{tr("Paling kerap ditanya")}</SelectItem>
              <SelectItem value="newest">{tr("Terbaru")}</SelectItem>
              <SelectItem value="oldest">{tr("Terlama")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr("Semua")}</SelectItem>
              <SelectItem value="unanswered">{tr("Belum dijawab")}</SelectItem>
              <SelectItem value="resolved">{tr("Selesai")}</SelectItem>
              <SelectItem value="dismissed">{tr("Diabaikan")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="lc-card overflow-x-auto p-0">
        {query.isError ? (
          <p role="alert" className="p-6 text-sm text-destructive">{query.error.message}</p>
        ) : query.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">{tr("Memuatkan…")}</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{tr("Tiada soalan dalam senarai ini.")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="p-3">{tr("Soalan")}</th>
                <th className="p-3">{tr("Pelanggan")}</th>
                <th className="p-3">{tr("Masa")}</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">{tr("Tindakan")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                  onClick={() => setDetailId(r.id)}
                >
                  <td className="p-3">
                    <div className="font-medium">{r.question}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{tr("Ditanya ")}{r.occurrence_count}×</span>
                      {r.failed_after_faq_count > 0 && (
                        <span className="font-semibold text-destructive">{tr("Gagal ")}{r.failed_after_faq_count}{tr("× walaupun FAQ sudah ada ")}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    {r.last_customer?.customer_name ?? r.last_customer?.customer_phone ?? "—"}
                  </td>
                  <td className="p-3 whitespace-nowrap">{formatDate(r.last_asked_at)}</td>
                  <td className="p-3"><StatusBadge status={r.status} /></td>
                  <td className="p-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {r.status !== "resolved" && (
                      <Button size="sm" onClick={() => setFaqFor({ id: r.id, question: r.question })}>{tr("Tambah ke FAQ ")}</Button>
                    )}
                    {r.status === "unanswered" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-2"
                        disabled={dismissMut.isPending}
                        onClick={() => dismissMut.mutate(r.id)}
                      >{tr("Abaikan ")}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <DetailDialog row={detail} onClose={() => setDetailId(null)} />
      <FaqDialog target={faqFor} onClose={() => setFaqFor(null)} />
    </ConsoleShell>
  );
}

function DetailDialog({
  row,
  onClose,
}: {
  row: { id: string; question: string; occurrence_count: number } | null;
  onClose: () => void;
}) {
  const { translate: tr, formatDate } = usePreferences();
  const fetchDetail = useApi(getUnansweredQuestionDetail);
  const q = useQuery({
    queryKey: ["unanswered-detail", row?.id],
    queryFn: () => fetchDetail({ data: { id: row!.id } }),
    enabled: !!row,
  });
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row?.question}</DialogTitle>
          <DialogDescription>{tr("Ditanya ")}{row?.occurrence_count}{tr("× — semua kejadian:")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {(q.data ?? []).map((o) => (
            <div key={o.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">“{o.question_text}”</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{o.customer_name ?? o.customer_phone ?? "—"}</span>
                <span>{formatDate(o.created_at)}</span>
                {o.failed_after_faq && <span className="font-semibold text-destructive">{tr("Selepas FAQ wujud")}</span>}
                {o.chat_id && (
                  <Link to="/dashboard/inbox" search={{ chat: o.chat_id }} className="font-semibold text-primary underline">{tr("Buka perbualan ")}</Link>
                )}
              </div>
            </div>
          ))}
          {q.isError && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
          {q.isLoading && <p className="text-sm text-muted-foreground">{tr("Memuatkan…")}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FaqDialog({ target, onClose }: { target: { id: string; question: string } | null; onClose: () => void }) {
  const { translate: tr, formatDate } = usePreferences();
  const qc = useQueryClient();
  const resolve = useApi(resolveUnansweredWithFaq);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [lastId, setLastId] = useState<string | null>(null);
  if (target && target.id !== lastId) {
    setLastId(target.id);
    setQuestion(target.question);
    setAnswer("");
  }
  const mut = useMutation({
    mutationFn: () => resolve({ data: { id: target!.id, question, answer } }),
    onSuccess: () => {
      toast.success(tr("FAQ disimpan dan soalan ditanda selesai"));
      qc.invalidateQueries({ queryKey: ["unanswered"] });
      qc.invalidateQueries({ queryKey: ["faqs"] });
      setLastId(null);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o && !mut.isPending) { setLastId(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("Tambah ke FAQ")}</DialogTitle>
          <DialogDescription>{tr("Tulis jawapan. Bot akan guna jawapan ini untuk soalan yang serupa.")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mut.isPending && target) mut.mutate();
          }}
        >
          <div>
            <Label htmlFor="faq-q">{tr("Soalan")}</Label>
            <Input id="faq-q" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="faq-a">{tr("Jawapan")}</Label>
            <Textarea id="faq-a" rows={5} value={answer} maxLength={4000} onChange={(e) => setAnswer(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mut.isPending || !question.trim() || !answer.trim()}>
              {mut.isPending ? tr("Menyimpan…") : tr("Simpan FAQ")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

