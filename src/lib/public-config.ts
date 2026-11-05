/** Offline readiness check only; it does not validate credentials with Supabase. */
export function hasPublicConfig(url: string | undefined, key: string | undefined): boolean {
  if (!url?.trim() || !key?.trim() || /replace_me/i.test(url + key)) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
