import { BrandLogo } from "@/components/lokalchat/BrandLogo";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

function IconAnalytics() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18M8 17V9m4 8V5m4 12v-6" />
    </svg>
  );
}

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="lc-app">
      <aside className="lc-sidebar">
        <div className="lc-logo flex-wrap">
          <BrandLogo />
          <span className="lc-logo-tag">ADMIN</span>
        </div>

        <nav className="lc-nav">
          <div className="lc-nav-group-label">Platform</div>
          <Link to="/admin/analytics" className="lc-nav-item active">
            <IconAnalytics />
            Analitik Admin
          </Link>

          <div className="lc-nav-group-label">Akaun</div>
          <Link to="/dashboard" className="lc-nav-item">
            <IconBack />
            Kembali ke Dashboard SME
          </Link>
        </nav>

        <div className="lc-sidebar-foot">
          Log masuk sebagai <b>Admin</b>
        </div>
      </aside>
      <main className="lc-main">{children}</main>
    </div>
  );
}

