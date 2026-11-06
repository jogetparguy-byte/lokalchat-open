/**
 * Server-only text extraction + chunking for knowledge base documents.
 * Supports PDF (unpdf), DOCX (bounded ZIP worker) and CSV/TXT.
 */
import { strFromU8 } from "fflate";
import { readDocxText, MAX_DOCUMENT_TEXT } from "./docx-worker.server";
export { MAX_DOCUMENT_TEXT };

function normalize(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

export async function extractDocumentText(
  fileType: string,
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024)
    throw new Error("Saiz fail melebihi had");
  const type = fileType.toLowerCase();
  let text: string;
  if (type === "pdf") text = await extractPdf(bytes);
  else if (type === "docx" || type === "doc") text = await readDocxText(bytes);
  else if (type === "csv" || type === "txt") text = strFromU8(bytes);
  else throw new Error(`Jenis fail tidak disokong: ${fileType}`);
  if (text.length > MAX_DOCUMENT_TEXT)
    throw new Error("Teks dokumen terlalu panjang");
  return normalize(text);
}

/** Split text into ~1000 character chunks with a small overlap. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  if (
    !Number.isInteger(size) ||
    !Number.isInteger(overlap) ||
    size <= 0 ||
    overlap < 0 ||
    overlap >= size
  ) {
    throw new Error("Tetapan chunk tidak sah");
  }
  if (text.length > MAX_DOCUMENT_TEXT)
    throw new Error("Teks dokumen terlalu panjang");
  const clean = text.trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < 200) {
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
  return chunks.slice(0, 200);
}
