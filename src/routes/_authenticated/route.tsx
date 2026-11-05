import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hasPublicConfig } from "@/lib/public-config";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const [verified, setVerified] = useState<string | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    const leave = () => {
      if (!active) return;
      setVerified(null);
      void navigate({ to: "/auth", replace: true });
    };
    if (!hasPublicConfig(import.meta.env["VITE_SUPABASE_URL"], import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"])) {
      leave();
      return;
    }
    // Redirect after hydration. A redirect from beforeLoad during hydration can
    // invalidate the server's match tree before React finishes mounting it.
    let verification = 0;
    const verify = () => {
      const current = ++verification;
      void supabase.auth.getUser().then(({ data, error }) => {
        if (!active || current !== verification) return;
        if (error || !data.user) leave();
        else setVerified(data.user.id);
      }).catch(() => { if (active && current === verification) leave(); });
    };
    verify();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        verification++;
        leave();
      } else if (session?.user.id) {
        // Hide the previous account before verifying the replacement session.
        setVerified(previous => previous === session.user.id ? previous : null);
        verify();
      }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [navigate]);
  // Server authorization is enforced separately on every server function.
  return verified ? <AccountQueries key={verified} /> : <p role="status" className="p-8 text-sm">Menyemak sesi…</p>;
}

function AccountQueries() {
  // Remounting by verified account also isolates late query and mutation results.
  const [client] = useState(() => new QueryClient());
  useEffect(() => () => { client.clear(); }, [client]);
  return <QueryClientProvider client={client}><Outlet /></QueryClientProvider>;
}
