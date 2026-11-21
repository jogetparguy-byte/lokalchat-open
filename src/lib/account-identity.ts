const MODE = "lokalchat-auth-mode";
let owner: string | null = null;

export function accountIdentity() { return owner; }
export function setAccountIdentity(id: string | null) { owner = id; }
export function localAuthMode(): boolean {
  try { return localStorage.getItem(MODE) === "local"; } catch { return false; }
}
export function setLocalAuthMode() {
  try { localStorage.setItem(MODE, "local"); } catch { /* The server still verifies every cookie. */ }
}
export function setHostedAuthMode() {
  try { localStorage.setItem(MODE, "hosted"); } catch { /* The server still verifies every bearer token. */ }
}
