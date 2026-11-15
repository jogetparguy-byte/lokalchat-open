import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/account")({
  server: { handlers: {
    GET: async ({ request }) => (await import("@/lib/account-http.server")).handleAccountRequest(request),
    POST: async ({ request }) => (await import("@/lib/account-http.server")).handleAccountRequest(request),
  } },
});
