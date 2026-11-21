import { createContext, useContext } from "react";

export const AccountIdentityContext = createContext<string | null>(null);

export function useAccountIdentity() {
  return useContext(AccountIdentityContext);
}
