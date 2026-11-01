/** Production adapter: every operation runs through authenticated server functions. */
export * from "@/lib/lokalchat.functions";
export { useServerFn as useApi } from "@tanstack/react-start";
