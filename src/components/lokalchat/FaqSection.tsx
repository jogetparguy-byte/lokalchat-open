import { usePreferences } from "@/components/lokalchat/usePreferences";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApi, listFaqs, saveFaq, deleteFaq } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** The list includes manual FAQ entries and extracted document chunks. */
export function FaqSection() {
  const { translate: tr } = usePreferences();
  const queryClient = useQueryClient();
  const fetchFaqs = useApi(listFaqs);
  const createFaq = useApi(saveFaq);
  const removeFaq = useApi(deleteFaq);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const query = useQuery({ queryKey: ["faqs"], queryFn: fetchFaqs });
  const save = useMutation({
    mutationFn: () => createFaq({ data: { question, answer } }),
    onSuccess: (result) => {
      setQuestion(""); setAnswer("");
      void queryClient.invalidateQueries({ queryKey: ["faqs"] });
      toast.success(result.embedded ? tr("FAQ berjaya disimpan") : tr("FAQ disimpan dengan carian kata kunci"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => removeFaq({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["faqs"] });
      setDeleteId(null);
      toast.success(tr("Entri dipadam"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <section className="mt-8 space-y-4 border-t border-border pt-6">
      <h2 className="text-lg font-semibold">{tr("FAQ dan kandungan dipelajari")}</h2>
      <p className="text-sm text-muted-foreground">{tr("Tambah jawapan kedai secara terus. Senarai turut mengandungi petikan dokumen, maksimum 100 entri terkini.")}</p>
      <form className="max-w-xl space-y-3" onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
        <div className="space-y-1"><Label htmlFor="faq-question">{tr("Soalan")}</Label><Input id="faq-question" required maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="faq-answer">{tr("Jawapan")}</Label><Textarea id="faq-answer" required maxLength={4000} value={answer} onChange={(event) => setAnswer(event.target.value)} /></div>
        <Button disabled={save.isPending || !question.trim() || !answer.trim()}>{save.isPending ? tr("Menyimpan…") : tr("Tambah FAQ")}</Button>
      </form>
      {query.isPending && <p className="text-sm">{tr("Memuatkan FAQ…")}</p>}
      {query.isError && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
      {query.data?.length === 0 && <p className="text-sm text-muted-foreground">{tr("Belum ada kandungan.")}</p>}
      <ul className="space-y-2">
        {query.data?.map((entry) => (
          <li key={entry.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0"><p className="whitespace-pre-wrap break-words text-sm">{entry.content}</p><p className="mt-2 text-xs text-muted-foreground">{entry.has_embedding ? tr("Carian semantik tersedia") : tr("Carian kata kunci")}</p></div>
            <Button type="button" variant="outline" size="sm" onClick={() => setDeleteId(entry.id)}>{tr("Padam")}</Button>
          </li>
        ))}
      </ul>
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open && !remove.isPending) setDeleteId(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{tr("Padam entri ini?")}</AlertDialogTitle><AlertDialogDescription>{tr("Kandungan ini akan dikeluarkan daripada carian AI. Tindakan ini tidak boleh dibatalkan.")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={remove.isPending}>{tr("Batal")}</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} onClick={(event) => { event.preventDefault(); if (deleteId !== null) remove.mutate(deleteId); }}>{remove.isPending ? tr("Memadam…") : tr("Padam")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
