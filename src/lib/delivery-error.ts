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
} as const;

const publicErrors = new Set<string>(Object.values(DELIVERY_ERRORS));

export function safeDeliveryError(error: unknown): string | null {
  if (error == null || error === "") return null;
  return typeof error === "string" && publicErrors.has(error) ? error : DELIVERY_ERRORS.failed;
}

export function deliveryErrorForStatus(status: number): string {
  if (status === 401 || status === 403) return DELIVERY_ERRORS.authorization;
  if (status === 429) return DELIVERY_ERRORS.rateLimit;
  if (status >= 500) return DELIVERY_ERRORS.unavailable;
  return DELIVERY_ERRORS.failed;
}
