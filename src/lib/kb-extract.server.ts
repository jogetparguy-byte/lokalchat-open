/**
 * Server-only text extraction + chunking for knowledge base documents.
 * Supports PDF (unpdf), DOCX (fflate + document.xml) and CSV/TXT.
 *
 * Security: Limits on zip entries, decompressed size, and chunk count to prevent
 * decompression bombs and resource exhaustion (SEC-002).
 */
import { Unzip, UnzipInflate, strFromU8 } from "fflate";

// Security limits for DOCX extraction
const MAX_ZIP_ENTRIES = 100;
const MAX_ENTRY_SIZE = 2 * 1024 * 1024; // 2 MiB per entry
const MAX_TOTAL_DECOMPRESSED = 10 * 1024 * 1024; // 10 MiB total
const MAX_CHUNKS = 200;

function normalize(text: string): string {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

function extractDocx(bytes: Uint8Array): string {
  if (bytes.length > 10 * 1024 * 1024) throw new Error("Fail DOCX melebihi had saiz");
  const names = new Set<string>();
  let declaredTotal = 0;
  let documentSize = 0;
  let complete = false;
  const chunks: Uint8Array[] = [];
  const archive = new Unzip(file => {
    if (names.has(file.name)) throw new Error("Arkib DOCX mengandungi entri berulang");
    names.add(file.name);
    // Reject declared resource limits before starting any decompressor.
    if (names.size > MAX_ZIP_ENTRIES) throw new Error("Arkib DOCX mengandungi terlalu banyak entri");
    if (file.originalSize !== undefined) {
      if (file.originalSize > MAX_ENTRY_SIZE) throw new Error("Entri DOCX melebihi had saiz");
      declaredTotal += file.originalSize;
      if (declaredTotal > MAX_TOTAL_DECOMPRESSED) throw new Error("Saiz terbit arkib melebihi had");
    }
    // Images and unrelated ZIP members are never inflated.
    if (file.name !== "word/document.xml") return;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      documentSize += data.length;
      if (documentSize > MAX_ENTRY_SIZE) throw new Error("Entri word/document.xml melebihi had saiz");
      chunks.push(data);
      complete = final;
    };
    file.start();
  });
  archive.register(UnzipInflate);
  // Bound each compressed input chunk, including archives with forged size metadata.
  for (let offset = 0; offset < bytes.length; offset += 256) {
    archive.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length);
  }
  if (!complete) throw new Error("Fail DOCX tidak sah atau tidak lengkap");
  const doc = new Uint8Array(documentSize);
  let offset = 0;
  for (const chunk of chunks) { doc.set(chunk, offset); offset += chunk.length; }

  const xml = strFromU8(doc);
  return xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity, name: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '\"', apos: "'" };
      if (named[name]) return named[name];
      const value = name.startsWith("#x") ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value) : entity;
    });
}

export async function extractDocumentText(
  fileType: string,
  bytes: Uint8Array,
): Promise<string> {
  const type = fileType.toLowerCase();
  if (type === "pdf") return normalize(await extractPdf(bytes));
  if (type === "docx" || type === "doc") return normalize(extractDocx(bytes));
  if (type === "csv" || type === "txt") return normalize(strFromU8(bytes));
  throw new Error(`Jenis fail tidak disokong: ${fileType}`);
}

/** Split text into ~1000 character chunks with a small overlap. Stops at MAX_CHUNKS. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const breakPoint = clean.lastIndexOf("\n", end);
      const sentence = clean.lastIndexOf(". ", end);
      const cut = Math.max(breakPoint, sentence);
      if (cut > start + size * 0.5) end = cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}