import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const [verified, setVerified] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    const leave = () => {
      if (!active) return;
      setVerified(false);
      void navigate({ to: "/auth", replace: true });
    };
    if (!import.meta.env["VITE_SUPABASE_URL"] || !import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]) {
      leave();
      return;
    }
    // Redirect after hydration. A redirect from beforeLoad during hydration can
    // invalidate the server's match tree before React finishes mounting it.
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error || !data.user) leave();
      else setVerified(true);
    }).catch(leave);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") leave();
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [navigate]);
  // Server authorization is enforced separately on every server function.
  return verified ? <Outlet /> : <p role="status" className="p-8 text-sm">Menyemak sesi…</p>;
}
