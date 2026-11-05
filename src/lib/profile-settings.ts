export type ProfilePatch = {
  businessName?: string;
  inventoryApiUrl?: string;
  ownerWhatsapp?: string;
};

export function validateProfilePatch(input: ProfilePatch) {
  if (!input || typeof input !== "object") throw new Error("Tetapan tidak sah");
  const patch: {
    business_name?: string;
    inventory_api_url?: string | null;
    owner_whatsapp?: string | null;
  } = {};
  if (input.businessName !== undefined) {
    if (
      typeof input.businessName !== "string" ||
      !input.businessName.trim() ||
      input.businessName.trim().length > 100
    )
      throw new Error("Nama perniagaan diperlukan (maks 100 aksara)");
    patch.business_name = input.businessName.trim();
  }
  if (input.inventoryApiUrl !== undefined) {
    if (
      typeof input.inventoryApiUrl !== "string" ||
      input.inventoryApiUrl.length > 2048
    )
      throw new Error("URL inventori tidak sah");
    const url = input.inventoryApiUrl.trim();
    if (url) {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol))
        throw new Error("URL mesti bermula dengan http:// atau https://");
    }
    patch.inventory_api_url = url || null;
  }
  if (input.ownerWhatsapp !== undefined) {
    if (typeof input.ownerWhatsapp !== "string")
      throw new Error("Nombor WhatsApp tidak sah");
    const phone = input.ownerWhatsapp.replace(/[\s+-]/g, "");
    if (phone && !/^\d{8,15}$/.test(phone))
      throw new Error("Nombor WhatsApp pemilik tidak sah (cth: 60123456789)");
    patch.owner_whatsapp = phone || null;
  }
  if (!Object.keys(patch).length)
    throw new Error("Tiada perubahan untuk disimpan");
  return patch;
}
