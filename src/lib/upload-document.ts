/** Upload bytes before recording metadata; remove unrecorded objects on failure. */
export const DOCUMENT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  txt: 'text/plain',
};

export function documentExtension(file: { name: string; size: number }): string {
  const extension = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!DOCUMENT_MIME[extension]) throw new Error('Hanya PDF, DOCX, CSV atau TXT dibenarkan');
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('Fail mesti antara 1 bait dan 10MB');
  return extension;
}

type StorageResult = { error: { message: string } | null };
type UploadOptions = {
  file: File;
  userId: string;
  nonce: string;
  storage: {
    upload: (path: string, file: File, options: { contentType: string; upsert: boolean }) => PromiseLike<StorageResult>;
    remove: (paths: string[]) => PromiseLike<StorageResult>;
  };
  record: (input: { data: { fileName: string; fileType: string; fileSize: number; storagePath: string } }) => Promise<{ id: string }>;
};

export async function uploadDocument({ file, userId, nonce, storage, record }: UploadOptions): Promise<string> {
  const extension = documentExtension(file);
  if (!userId || !nonce || userId.includes('/') || nonce.includes('/')) throw new Error('Sesi atau ID muat naik tidak sah');
  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const storagePath = `${userId}/${nonce}-${safeName}`;
  const result = await storage.upload(storagePath, file, { contentType: DOCUMENT_MIME[extension]!, upsert: false });
  if (result.error) throw new Error(result.error.message);
  try {
    const row = await record({ data: { fileName: file.name, fileType: extension, fileSize: file.size, storagePath } });
    return row.id;
  } catch (error) {
    let cleanupError: string | undefined;
    try {
      cleanupError = (await storage.remove([storagePath])).error?.message;
    } catch {
      cleanupError = 'Sambungan storan gagal';
    }
    const message = error instanceof Error ? error.message : 'Gagal merekod dokumen';
    throw new Error(cleanupError ? `${message}. Fail storan belum dibersihkan: ${storagePath}` : message);
  }
}
