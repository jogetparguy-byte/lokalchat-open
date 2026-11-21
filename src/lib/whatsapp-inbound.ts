type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const string = (value: unknown, maximum = 4096): string | null => typeof value === "string" && value.trim() ? value.slice(0, maximum) : null;

export type NormalizedWhatsAppInbound = {
  messageId: string;
  phone: string | null;
  bsuid: string | null;
  name: string | null;
  type: string;
  text: string;
  metadata: JsonRecord;
  needsHandoff: boolean;
  timestamp: string | undefined;
  opensServiceWindow: boolean;
};

/** Normalize provider content without treating unread media or arbitrary JSON as a customer instruction. */
export function normalizeWhatsAppInbound(input: unknown, inputContacts: unknown): NormalizedWhatsAppInbound {
  const message = record(input);
  const messageId = typeof message["id"] === "string" && message["id"].length <= 512 ? string(message["id"], 512) : null;
  const rawPhone = typeof message["from"] === "string" && message["from"].length <= 21 ? message["from"] : null;
  const phone = rawPhone && /^\+?\d{7,20}$/.test(rawPhone) ? rawPhone.replace(/^\+/, "") : null;
  const rawBsuid = typeof message["from_user_id"] === "string" ? message["from_user_id"] : null;
  const bsuid = rawBsuid && /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/.test(rawBsuid) ? rawBsuid : null;
  if (!messageId || (!phone && !bsuid)) throw new Error("WhatsApp inbound requires message ID and a supported phone or BSUID identity");
  const contacts = Array.isArray(inputContacts) ? inputContacts.map(record) : [];
  const contact = contacts.find(c => (bsuid && c["user_id"] === bsuid) || (phone && c["wa_id"] === phone));
  const name = string(record(contact?.["profile"])["name"], 200);
  const type = string(message["type"], 64) ?? "unknown";
  const content = record(message[type]);
  const metadata: JsonRecord = {};
  for (const key of ["id", "mime_type", "sha256", "filename", "caption"]) {
    const value = string(content[key], key === "caption" ? 4096 : 512);
    if (value) metadata[key] = value;
  }
  const contextId = string(record(message["context"])["id"], 512);
  if (contextId) metadata["context_message_id"] = contextId;
  let text: string | null = null;
  if (type === "text") text = string(content["body"]);
  if (type === "button") {
    text = string(content["text"]);
    metadata["response_id"] = string(content["payload"], 512);
  }
  if (type === "interactive") {
    const responseType = string(content["type"], 64);
    const response = record(content[responseType ?? ""]);
    metadata["interactive_type"] = responseType;
    if (responseType === "button_reply" || responseType === "list_reply") {
      text = string(response["title"]);
      metadata["response_id"] = string(response["id"], 512);
      metadata["description"] = string(response["description"]);
    }
  }
  const needsHandoff = !text;
  const labels: Record<string, string> = { image: "Gambar", audio: "Audio / nota suara", document: "Dokumen", video: "Video", sticker: "Pelekat", contacts: "Kad kenalan", location: "Lokasi", interactive: "Respons interaktif", system: "Peristiwa sistem" };
  return {
    messageId, phone, bsuid, name, type,
    text: text ?? `[${labels[type] ?? `Mesej ${type}`} diterima. Kandungan memerlukan semakan manusia.]${metadata["caption"] ? ` Kapsyen: ${metadata["caption"]}` : ""}`,
    metadata, needsHandoff,
    timestamp: typeof message["timestamp"] === "string" ? message["timestamp"] : undefined,
    opensServiceWindow: type !== "system",
  };
}
