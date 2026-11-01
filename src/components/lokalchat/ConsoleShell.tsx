import { BrandLogo } from "@/components/lokalchat/BrandLogo";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/services/api";
import { getMyRole } from "@/services/api";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function AccountCard() {
  const [info, setInfo] = useState<{ name: string; email: string; avatar: string | null } | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user;
      if (!u || !alive) return;
      const email = u.email ?? "";
      const meta = (u.user_metadata ?? {}) as Record<string, string | undefined>;
      const name = meta["full_name"] || meta["name"] || email.split("@")[0] || "Pengguna";
      let avatar = meta["avatar_url"] || meta["picture"] || null;

      if (alive) setInfo({ name, email, avatar });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!info) return null;
  const initial = info.name.charAt(0).toUpperCase();

  return (
    <div className="lc-account">
      {info.avatar && !imgFailed ? (
        <img
          src={info.avatar}
          alt={info.name}
          className="lc-account-avatar"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="lc-account-avatar lc-account-initial">{initial}</div>
      )}
      <div className="lc-account-text">
        <div className="lc-account-name">{info.name}</div>
        <div className="lc-account-email">{info.email}</div>
      </div>
    </div>
  );
}


function NavIconDashboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function NavIconChat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.1 9.1 0 0 1-3.3-.6L3 21l1.8-4.6A8.3 8.3 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1h.5A8.4 8.4 0 0 1 21 11.5z" />
    </svg>
  );
}

function NavIconKb() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h5a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4z" />
      <path d="M20 4h-5a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20z" />
    </svg>
  );
}

function NavIconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  );
}

function NavIconAdmin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fetchRole = useApi(getMyRole);
  const roleQuery = useQuery({ queryKey: ["my-role"], queryFn: fetchRole, staleTime: 5 * 60 * 1000 });
  const isAdmin = roleQuery.data?.role === "admin";


  return (
    <div className="lc-app">
      <aside className="lc-sidebar">
        <div className="lc-logo">
          <BrandLogo />
        </div>
        <nav className="lc-nav">
          <Link
            to="/dashboard"
            className={`lc-nav-item${pathname === "/dashboard" ? " active" : ""}`}
          >
            <NavIconDashboard />
            Dashboard
          </Link>
          <Link
            to="/dashboard/inbox"
            className={`lc-nav-item${pathname === "/dashboard/inbox" ? " active" : ""}`}
          >
            <NavIconChat />
            Live Chat
          </Link>
          <Link
            to="/dashboard/knowledge-base"
            className={`lc-nav-item${
              pathname === "/dashboard/knowledge-base" ? " active" : ""
            }`}
          >
            <NavIconKb />
            Knowledge Base
          </Link>
          <Link
            to="/dashboard/unanswered"
            className={`lc-nav-item${pathname === "/dashboard/unanswered" ? " active" : ""}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" />
            </svg>
            Soalan Tak Dijawab
          </Link>
          <Link
            to="/dashboard/settings"
            className={`lc-nav-item${
              pathname === "/dashboard/settings" ? " active" : ""
            }`}
          >
            <NavIconSettings />
            Settings
          </Link>
          {isAdmin && (
            <Link
              to="/admin/analytics"
              className={`lc-nav-item${
                pathname === "/admin/analytics" ? " active" : ""
              }`}
            >
              <NavIconAdmin />
              Admin
            </Link>
          )}
        </nav>

        <div className="lc-sidebar-foot">
          <button type="button" onClick={async () => {
            const { error } = await supabase.auth.signOut();
            if (error) { toast.error(error.message); return; }
            queryClient.clear();
            await navigate({ to: "/auth" });
          }}>Log keluar</button>
        </div>
        <AccountCard />
      </aside>
      <main className="lc-main">{children}</main>
    </div>
  );
}

