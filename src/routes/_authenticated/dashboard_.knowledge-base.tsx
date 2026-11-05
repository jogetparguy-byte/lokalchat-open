import { usePreferences } from "@/components/lokalchat/usePreferences";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/services/api";
import { toast } from "sonner";
import { ConsoleShell } from "@/components/lokalchat/ConsoleShell";
import { supabase } from "@/integrations/supabase/client";
import { uploadDocument } from "@/lib/upload-document";
import { FaqSection } from "@/components/lokalchat/FaqSection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deleteKbDocument,
  getSystemPrompt,
  listKbDocuments,
  processKbDocument,
  recordKbDocument,
  saveSystemPrompt,
} from "@/services/api";

export const Route = createFileRoute("/_authenticated/dashboard_/knowledge-base")({
  component: KnowledgeBasePage,
  head: () => ({
    meta: [
      { title: "Knowledge Base — LokalChat" },
      {
        name: "description",
        content:
          "Muat naik dokumen PDF, DOCX, CSV atau TXT dan tetapkan system prompt untuk ejen AI kedai anda.",
      },
      { property: "og:title", content: "Knowledge Base — LokalChat" },
      {
        property: "og:description",
        content:
          "Muat naik dokumen PDF, DOCX, CSV atau TXT dan tetapkan system prompt untuk ejen AI kedai anda.",
      },
    ],
  }),
});

const ACCEPT = ".pdf,.docx,.csv,.txt";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function KnowledgeBasePage() {
  const { translate: tr } = usePreferences();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const promptDirty = useRef(false);
  const uploadingRef = useRef(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const fetchDocs = useApi(listKbDocuments);
  const recordDoc = useApi(recordKbDocument);
  const processDoc = useApi(processKbDocument);
  const removeDoc = useApi(deleteKbDocument);
  const fetchPrompt = useApi(getSystemPrompt);
  const savePrompt = useApi(saveSystemPrompt);

  const docsQuery = useQuery({ queryKey: ["kb-documents"], queryFn: fetchDocs });
  const promptQuery = useQuery({ queryKey: ["system-prompt"], queryFn: fetchPrompt });

  useEffect(() => {
    if (promptQuery.data && !promptDirty.current) setPrompt(promptQuery.data.system_prompt ?? "");
  }, [promptQuery.data]);

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => removeDoc({ data: { documentId } }),
    onSuccess: (_result, documentId) => {
      queryClient.setQueryData(
        ["kb-documents"],
        (old: { id: string }[] | undefined) => old?.filter((d) => d.id !== documentId) ?? [],
      );
      queryClient.invalidateQueries({ queryKey: ["kb-documents"] });
      toast.success(tr("Fail berjaya dipadam"));
    },
    onError: (error: Error) => toast.error(error.message || tr("Gagal memadam fail")),
    onSettled: () => setPendingDelete(null),
  });

  const promptMutation = useMutation({
    mutationFn: (systemPrompt: string) => savePrompt({ data: { systemPrompt } }),
    onSuccess: () => {
      promptDirty.current = false;
      toast.success(tr("System prompt berjaya disimpan"));
      queryClient.invalidateQueries({ queryKey: ["system-prompt"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0 || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData.user?.id;
      if (!userId) throw new Error(tr("Sesi tamat. Sila log masuk semula."));

      for (const file of list) {
        try {
          const id = await uploadDocument({
            file,
            userId,
            nonce: crypto.randomUUID(),
            storage: supabase.storage.from("kb-documents"),
            record: recordDoc,
          });
          await queryClient.invalidateQueries({ queryKey: ["kb-documents"] });
          const result = await processDoc({ data: { id } });
          if (result.ok) toast.success(`${file.name} berjaya diproses`);
          else toast.error(`${file.name}: ${"message" in result ? result.message : tr("Ralat memproses fail")}`);
        } catch (error) {
          toast.error(`${file.name}: ${error instanceof Error ? error.message : tr("Muat naik gagal")}`);
        } finally {
          await queryClient.invalidateQueries({ queryKey: ["kb-documents"] });
          await queryClient.invalidateQueries({ queryKey: ["faqs"] });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["kb-documents"] });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <ConsoleShell>
      <div className="lc-topbar">
        <div>
          <h1>Knowledge Base</h1>
          <p>{tr("Latih ejen AI dengan dokumen dan arahan kedai anda")}</p>
        </div>
      </div>

      <div className="lc-kb-grid">
        <div>
          <div
            className={`lc-dropzone${dragging ? " dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void uploadFiles(e.dataTransfer.files);
            }}
          >
            <div className="lc-dropzone-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M12 16V4" />
                <path d="m7 9 5-5 5 5" />
                <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </div>
            <h3>{tr("Seret &amp; lepas fail di sini")}</h3>
            <p>{tr("PDF, DOCX, CSV atau TXT — maksimum 10MB setiap fail")}</p>
            <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {uploading ? tr("Memuat naik…") : tr("Pilih Fail")}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
            />
          </div>

          <div className="lc-kb-list">
            {docsQuery.isError ? (
              <p role="alert" className="p-3 text-sm text-destructive">{docsQuery.error.message}</p>
            ) : docsQuery.isPending ? (
              <div className="lc-kb-item">
                <span className="lc-kb-item-name">{tr("Memuatkan…")}</span>
              </div>
            ) : (docsQuery.data?.length ?? 0) === 0 ? (
              <div className="lc-kb-item">
                <span className="lc-kb-item-name">{tr("Belum ada dokumen dimuat naik")}</span>
              </div>
            ) : (
              docsQuery.data!.map((doc) => (
                <div key={doc.id} className="lc-kb-item">
                  <span className="lc-kb-item-icon">{doc.file_type}</span>
                  <span className="lc-kb-item-name">{doc.file_name}</span>
                  <span className="lc-kb-item-meta">
                    {formatSize(doc.file_size)} ·{" "}
                    {doc.status === "processed"
                      ? "Diproses"
                      : doc.status === "failed"
                        ? (doc.status_message ?? tr("Ralat memproses fail"))
                        : tr("Sedang diproses…")}
                  </span>
                  <button
                    type="button"
                    className="lc-kb-item-delete"
                    aria-label={`Padam ${doc.file_name}`}
                    disabled={deleteMutation.isPending || uploading}
                    onClick={() => setPendingDelete({ id: doc.id, name: doc.file_name })}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lc-prompt-box">
          <h3>System Prompt</h3>
          <p>{tr("Arahan personaliti dan peraturan untuk ejen AI anda.")}</p>
          {promptQuery.isError && <p role="alert" className="text-sm text-destructive">{promptQuery.error.message}</p>}
          <textarea
            maxLength={8000}
            disabled={promptQuery.isPending || promptQuery.isError || promptMutation.isPending}
            value={prompt}
            onChange={(e) => { promptDirty.current = true; setPrompt(e.target.value); }}
            placeholder={tr("Contoh: Anda ialah pembantu kedai yang mesra, jawab dalam Bahasa Melayu santai…")}
          />
          <button
            type="button"
            className="lc-prompt-save"
            disabled={promptMutation.isPending || promptQuery.isPending || promptQuery.isError}
            onClick={() => promptMutation.mutate(prompt)}
          >
            {promptMutation.isPending ? tr("Menyimpan…") : tr("Simpan System Prompt")}
          </button>
        </div>
      </div>
      <FaqSection />
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("Padam fail ini?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.name}{tr(" dan semua kandungan yang dipelajari daripadanya akan dipadam terus. Tindakan ini tidak boleh dibatalkan. ")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("Batal")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
              }}
              disabled={deleteMutation.isPending || uploading}
            >
              {deleteMutation.isPending ? tr("Memadam…") : tr("Padam")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConsoleShell>
  );
}

