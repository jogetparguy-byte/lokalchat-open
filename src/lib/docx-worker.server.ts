import { Worker } from "node:worker_threads";

export const MAX_DOCUMENT_TEXT = 160000;

/** Self-contained worker entry: built-ins only, so it also works in the Nitro bundle. */
const DOCX_WORKER_SOURCE = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const { inflateRawSync } = require("node:zlib");
  const bytes = Buffer.from(workerData.bytes);
  const maxXml = 2 * 1024 * 1024;
  const fail = () => { throw new Error("Fail DOCX tidak sah atau melebihi had pemprosesan"); };
  try {
    // Read central directory (supports ordinary ZIP data descriptors, rejects ZIP64/multidisk).
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { eocd = i; break; }
    }
    if (eocd < 0 || bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6)) fail();
    const entries = bytes.readUInt16LE(eocd + 10);
    const directorySize = bytes.readUInt32LE(eocd + 12);
    let offset = bytes.readUInt32LE(eocd + 16);
    const directoryEnd = offset + directorySize;
    if (!entries || entries > 1000 || bytes.readUInt16LE(eocd + 8) !== entries || directoryEnd !== eocd) fail();
    let xml;
    let total = 0;
    for (let i = 0; i < entries; i++) {
      if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== 0x02014b50) fail();
      const flags = bytes.readUInt16LE(offset + 8);
      const method = bytes.readUInt16LE(offset + 10);
      const compressed = bytes.readUInt32LE(offset + 20);
      const original = bytes.readUInt32LE(offset + 24);
      const nameLength = bytes.readUInt16LE(offset + 28);
      const extraLength = bytes.readUInt16LE(offset + 30);
      const commentLength = bytes.readUInt16LE(offset + 32);
      const local = bytes.readUInt32LE(offset + 42);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > directoryEnd || flags & 1 || bytes.readUInt16LE(offset + 34)) fail();
      total += original;
      if (total > 20 * 1024 * 1024 || original === 0xffffffff || compressed === 0xffffffff) fail();
      const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
      if (name === "word/document.xml") {
        if (xml || original > maxXml || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) fail();
        if (bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) fail();
        const localNameLength = bytes.readUInt16LE(local + 26);
        const start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
        if (start + compressed > bytes.readUInt32LE(eocd + 16) ||
            bytes.subarray(local + 30, local + 30 + localNameLength).toString("utf8") !== name) fail();
        const data = bytes.subarray(start, start + compressed);
        if (method === 0) { if (data.length > maxXml) fail(); xml = data; }
        else if (method === 8) xml = inflateRawSync(data, { maxOutputLength: maxXml });
        else fail();
        if (!xml || xml.length !== original) fail();
      }
      offset = next;
    }
    if (offset !== directoryEnd || !xml) fail();
    const text = xml.toString("utf8")
      .replace(/<w:p(?:\s[^<>]*)?>/g, "\n")
      .replace(/<w:tab(?:\s[^<>]*)?\s*\/>/g, " ")
      .replace(/<[^<>]*>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    if (text.length > workerData.maxText) fail();
    parentPort.postMessage({ text });
  } catch {
    parentPort.postMessage({ error: "Fail DOCX tidak sah atau melebihi had pemprosesan" });
  }
`;

export function readDocxText(
  bytes: Uint8Array,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(DOCX_WORKER_SOURCE, {
      eval: true,
      workerData: { bytes, maxText: MAX_DOCUMENT_TEXT },
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
      },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Pemprosesan DOCX tamat masa"));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      void worker.terminate();
    };
    worker.once("message", (result: { text?: string; error?: string }) => {
      finish();
      if (result.error || typeof result.text !== "string")
        reject(new Error(result.error ?? "Fail DOCX tidak sah"));
      else resolve(result.text);
    });
    worker.once("error", (error) => {
      finish();
      reject(error);
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Pemprosesan DOCX dihentikan"));
    });
  });
}
