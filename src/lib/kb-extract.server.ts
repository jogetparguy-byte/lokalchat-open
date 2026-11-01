/**
 * Server-only text extraction + chunking for knowledge base documents.
 * Supports PDF (unpdf), DOCX (fflate + document.xml) and CSV/TXT.
 */
import { unzipSync, strFromU8 } from "fflate";

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
  const files = unzipSync(bytes);
  const doc = files["word/document.xml"];
  if (!doc) throw new Error("Fail DOCX tidak sah");
  const xml = strFromU8(doc);
  return xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
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

/** Split text into ~1000 character chunks with a small overlap. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
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

