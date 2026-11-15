import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/supabase/mcp")({
  server: { handlers: {
    GET: async ({ request }) => (await import("@/lib/supabase-mcp.server")).handleSupabaseMcp(request),
    POST: async ({ request }) => (await import("@/lib/supabase-mcp.server")).handleSupabaseMcp(request),
  } },
});
