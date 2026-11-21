import { supabaseAdmin } from "@/integrations/supabase/client.server";

type CommercialKind = "price" | "promotion" | "stock";
const DAY = 86_400_000;
const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Deliberately broad: false positives transfer to the owner rather than quote a guess. */
export function commercialKinds(text: string): Set<CommercialKind> {
  const kinds = new Set<CommercialKind>();
  if (/\b(harga|price|prices|pricing|cost|costs|berapa|brp|bape|brapa|ringgit|rm\s*\d+(?:[.,]\d+)?|myr|usd|sgd|murah|mahal|cheap|expensive|bayar|pay|total|shipping|postage|delivery fee|caj|ongkir|kos)\b|[$€£]/iu.test(text)) kinds.add("price");
  if (/\b(promo\w*|diskaun|discount\w*|sale|clearance|offer\w*|voucher\w*|coupon\w*|kupon|potongan|percuma|free|cashback|rebate|deal\w*|buy\s*\d|get\s*\d)\b|\d\s*%/iu.test(text)) kinds.add("promotion");
  if (/\b(sto[ck]k?\w*|inventory|inventori|available|availability|sold\s*out|in\s*stock|out\s*of\s*stock|ready\w*|habis|baki|tersedia|ada\s*(lagi|tak|ke|x)|restock|quantity|kuantiti)\b/iu.test(text)) kinds.add("stock");
  return kinds;
}

function fresh(value: unknown, now: number, maxAge: number): boolean {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAge;
}

function future(value: unknown, now: number): boolean {
  return typeof value === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Date.parse(value) > now;
}

function parseRecord(content: string): Record<string, unknown> | null {
  try {
    // saveFaq stores its answer with this prefix; never parse instructions around JSON.
    const answer = content.startsWith("Soalan: ") ? content.split("\nJawapan: ").slice(1).join("\nJawapan: ") : content;
    const value: unknown = JSON.parse(answer);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch { return null; }
}

export type CommercialInventory = { product: string; stock: number; updated_at: string };

/** Single inventory transport shared by the model tool and the output gate. */
export async function readCommercialInventory(product: string, businessId: string | null, now = Date.now()): Promise<CommercialInventory | null> {
  if (!businessId || !product.trim() || product.length > 200) return null;
  try {
    const { data, error } = await supabaseAdmin.from("profiles").select("inventory_api_url").eq("id", businessId).maybeSingle();
    if (error || !data?.inventory_api_url) return null;
    const url = new URL(data.inventory_api_url);
    url.searchParams.set("product", product);
    const { fetchPublicHttp } = await import("./ssrf.server");
    const response = await fetchPublicHttp(url.toString(), { headers: { Accept: "application/json" }, maxBytes: 64 * 1024, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const value = JSON.parse(await response.text()) as Record<string, unknown>;
    if (typeof value["product"] !== "string" || normalized(value["product"]) !== normalized(product)
      || typeof value["stock"] !== "number" || !Number.isSafeInteger(value["stock"]) || value["stock"] < 0
      || !fresh(value["updated_at"], now, 5 * 60_000)) return null;
    return { product, stock: value["stock"], updated_at: value["updated_at"] as string };
  } catch { return null; }
}

export async function enforceCommercialGrounding(params: {
  businessId: string | null; userMessage: string; replies: string[]; history?: string[]; now?: number; replyLanguage?: string;
}): Promise<{ required: boolean; replies: string[] | null; reason: string }> {
  const { businessId, userMessage, replies, history = [], now = Date.now() } = params;
  const kinds = commercialKinds([userMessage, ...replies].join("\n"));
  // Resolve short follow-ups conservatively; never let an old quote become fresh evidence.
  if (history.some(text => commercialKinds(text).size > 0) && /^(yang\s+ni|yang\s+tu|ni|tu|this|that|it|yes|ya|ok|okay)[?.!\s]*$/iu.test(userMessage.trim())) {
    for (const text of history) for (const kind of commercialKinds(text)) kinds.add(kind);
  }
  if (kinds.size === 0) return { required: false, replies, reason: "noncommercial" };
  const blocked = (reason: string) => ({ required: true, replies: null, reason });
  if (!businessId) return blocked("missing_owner");
  if (/\b(shipping|postage|delivery fee|caj|ongkir|kos pos|total|checkout|stacking|selepas diskaun|after discount|convert|conversion|exchange rate|tukar mata wang|gabung diskaun|gabung promo|stack discount)\b/iu.test(userMessage)) return blocked("unsupported_commercial_terms");
  try {
    const { data, error } = await supabaseAdmin.from("knowledge_base").select("id, content, business_id")
      .eq("business_id", businessId).ilike("content", "%commercial_facts%").limit(101);
    if (error || !data || data.length > 100) return blocked("lookup_failed_or_over_limit");
    const question = ` ${normalized(userMessage)} `;
    const records = data.filter(row => row.business_id === businessId).map(row => parseRecord(row.content))
      .filter((record): record is Record<string, unknown> => Boolean(record && record["type"] === "commercial_facts"
        && typeof record["product"] === "string" && record["product"].length > 0 && record["product"].length <= 200
        && question.includes(` ${normalized(record["product"])} `)));
    if (records.length === 0) return blocked("no_product_evidence");
    // Multiple records, including stale alternatives, are ambiguous until the owner removes them.
    const unique = [...new Set(records.map(record => JSON.stringify(record)))];
    if (unique.length !== 1) return blocked("conflicting_evidence");
    const record = records[0]!;
    if (!fresh(record["verified_at"], now, 30 * DAY) || !future(record["valid_until"], now)) return blocked("stale_evidence");
    const product = record["product"] as string;
    // Product labels are rendered as text, never accepted as free-form instructions.
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._()/-]{0,199}$/u.test(product)) return blocked("invalid_product");
    const output: string[] = [];
    if (kinds.has("price")) {
      const price = record["price"] as Record<string, unknown> | undefined;
      if (!price || price["currency"] !== "MYR" || typeof price["amount"] !== "number" || !Number.isFinite(price["amount"])
        || price["amount"] < 0 || price["amount"] > 1_000_000 || Math.abs(price["amount"] * 100 - Math.round(price["amount"] * 100)) > 0.00001) return blocked("no_valid_price");
      output.push(`${product}: RM${price["amount"].toFixed(2)}.`);
    }
    if (kinds.has("promotion")) {
      const promotion = record["promotion"] as Record<string, unknown> | undefined;
      if (!promotion || typeof promotion["discount_percent"] !== "number" || !Number.isFinite(promotion["discount_percent"])
        || promotion["discount_percent"] <= 0 || promotion["discount_percent"] > 100 || typeof promotion["valid_from"] !== "string"
        || !fresh(promotion["valid_from"], now, 30 * DAY) || !future(promotion["valid_until"], now)) return blocked("no_valid_promotion");
      output.push(params.replyLanguage === "en"
        ? `${product}: ${promotion["discount_percent"]}% discount until ${new Date(promotion["valid_until"] as string).toISOString()}.`
        : `${product}: diskaun ${promotion["discount_percent"]}% sehingga ${new Date(promotion["valid_until"] as string).toISOString()}.`);
    }
    if (kinds.has("stock")) {
      const stock = await readCommercialInventory(product, businessId, now);
      if (!stock) return blocked("no_valid_inventory");
      output.push(params.replyLanguage === "en" ? `${product}: stock ${stock.stock} units.` : `${product}: stok ${stock.stock} unit.`);
    }
    return { required: true, replies: output, reason: "verified_evidence" };
  } catch { return blocked("lookup_failed"); }
}
