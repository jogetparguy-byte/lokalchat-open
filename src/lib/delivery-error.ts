/** Public delivery errors are an exact allowlist, never provider response text.
 * This also protects responses containing legacy errors already stored in the DB.
 */
export const DELIVERY_ERRORS = {
  failed: "Penghantaran WhatsApp gagal. Cuba semula kemudian.",
  connection: "Sambungan WhatsApp belum tersedia. Semak tetapan sambungan.",
  authorization: "Sambungan WhatsApp perlu disambungkan semula.",
  rateLimit: "Had penghantaran WhatsApp dicapai. Cuba semula kemudian.",
  unavailable: "Perkhidmatan WhatsApp sementara tidak tersedia. Cuba semula kemudian.",
  uncertain: "Status penghantaran belum dapat disahkan. Muat semula mesej sebelum mencuba lagi.",
  windowClosed: "Tetingkap servis WhatsApp telah tamat atau belum diketahui. Gunakan template diluluskan atau tunggu mesej pelanggan.",
  template: "Template WhatsApp diluluskan belum dikonfigurasi atau tidak sah.",
  recipient: "Identiti penerima WhatsApp tidak sah.",
  bsuidUnavailable: "Penghantaran WhatsApp melalui BSUID belum diaktifkan. Pemilik perlu mengesahkan sokongan versi API dan akaun.",
} as const;

const publicErrors = new Set<string>(Object.values(DELIVERY_ERRORS));

export function safeDeliveryError(error: unknown): string | null {
  if (error == null || error === "") return null;
  if (typeof error === "string" && /^Meta gagal menghantar(?: \(kod [0-9, ]+\))?\. Semak sambungan, penerima dan template sebelum cuba semula\.$/.test(error)) return error;
  return typeof error === "string" && publicErrors.has(error) ? error : DELIVERY_ERRORS.failed;
}

export function providerDeliveryFailure(codes: number[] = []): string {
  const values = codes.filter(code => Number.isSafeInteger(code) && code >= 0).slice(0, 10);
  return `Meta gagal menghantar${values.length ? ` (kod ${values.join(", ")})` : ""}. Semak sambungan, penerima dan template sebelum cuba semula.`;
}

export function deliveryErrorForStatus(status: number): string {
  if (status === 401 || status === 403) return DELIVERY_ERRORS.authorization;
  if (status === 429) return DELIVERY_ERRORS.rateLimit;
  if (status >= 500) return DELIVERY_ERRORS.unavailable;
  return DELIVERY_ERRORS.failed;
}
