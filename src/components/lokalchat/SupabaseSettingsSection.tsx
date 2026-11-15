import { usePreferences } from "@/components/lokalchat/usePreferences";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

const ENDPOINT = "/api/supabase/mcp";

async function connectorRequest(method: "GET" | "POST", signal?: AbortSignal) {
  const response = await fetch(ENDPOINT, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error("CONNECTOR_FAILED");
  return response.json();
}

export function SupabaseSettingsSection() {
  const { t } = usePreferences();
  const [callback, setCallback] = useState<string | null>(null);
  const query = useQuery<{ connected: boolean; needsReconnect: boolean }>({
    queryKey: ["supabase-mcp"],
    queryFn: ({ signal }) => connectorRequest("GET", signal),
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("supabase_mcp");
    if (result) {
      setCallback(result);
      url.searchParams.delete("supabase_mcp");
      window.history.replaceState(window.history.state, "", url.href);
    }
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await connectorRequest("POST");
      const url = new URL(result.authorizationUrl);
      if (url.origin !== "https://api.supabase.com" || url.pathname !== "/v1/oauth/authorize" || url.username || url.password) throw new Error("INVALID_AUTH_URL");
      window.location.assign(url.href);
    },
    onMutate: () => setCallback(null),
    onSuccess: (): void => { mutation.reset(); },
    retry: false,
  });

  const error = mutation.isError || callback === "failed";
  return (
    <section id="supabase" data-ui aria-labelledby="supabase-title" className="mt-10 scroll-mt-6 border-t border-border pt-8">
      <h2 id="supabase-title" className="text-lg font-semibold">Supabase</h2>
      <Button
        type="button"
        className="mt-4 cursor-pointer"
        disabled={mutation.isPending}
        aria-busy={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        MCP Connector
      </Button>
      <div className="mt-3 text-sm" aria-live="polite">
        {mutation.isPending ? (
          <p role="status">{t("Membuka auth Supabase…", "Opening Supabase authorization…")}</p>
        ) : error ? (
          <p role="alert" className="text-destructive">{t("Sambungan gagal. Tekan MCP Connector untuk cuba semula.", "Connection failed. Press MCP Connector to try again.")}</p>
        ) : callback === "cancelled" ? (
          <p role="status">{t("Auth dibatalkan. Tekan MCP Connector untuk cuba semula.", "Authorization cancelled. Press MCP Connector to try again.")}</p>
        ) : query.isPending ? (
          <p role="status">{t("Menyemak sambungan…", "Checking connection…")}</p>
        ) : query.isError ? (
          <p role="alert" className="text-destructive">{t("Status sambungan tidak dapat dimuatkan. Tekan MCP Connector untuk menyambung.", "Connection status could not be loaded. Press MCP Connector to connect.")}</p>
        ) : query.data?.connected ? (
          <p role="status">{t("MCP Supabase disambungkan. Sambungan data aplikasi belum diaktifkan.", "Supabase MCP is connected. The application's data connection is not yet active.")}</p>
        ) : query.data?.needsReconnect ? (
          <p role="status">{t("Sambungan tamat. Tekan MCP Connector untuk auth semula.", "Connection expired. Press MCP Connector to authorize again.")}</p>
        ) : null}
      </div>
    </section>
  );
}
