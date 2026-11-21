import { accountIdentity } from "./account-identity";

/** Keep an old component's request bound to its owner after the browser cookie changes. */
export function bindAccountRequest<T extends (...args: any[]) => Promise<any>>(request: T, expected: string | null): T {
  return ((...args: Parameters<T>) => {
    if (!expected) return request(...args);
    if (accountIdentity() !== expected) throw new Error("Akaun telah berubah. Muat semula halaman.");
    const [options, ...rest] = args;
    const headers = new Headers(options?.headers);
    headers.set("x-lokalchat-account", expected);
    return request({ ...options, headers }, ...rest);
  }) as T;
}
