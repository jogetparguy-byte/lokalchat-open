/** Production adapter: every operation runs through authenticated server functions. */
import { useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAccountIdentity } from "@/components/lokalchat/AccountIdentityContext";
import { bindAccountRequest } from "@/lib/account-request";

export * from "@/lib/lokalchat.functions";
export * from "@/lib/handoff.functions";

export function useApi<T extends (...args: any[]) => Promise<any>>(serverFn: T) {
  const request = useServerFn(serverFn);
  const owner = useAccountIdentity();
  return useMemo(() => bindAccountRequest(request, owner), [request, owner]);
}
