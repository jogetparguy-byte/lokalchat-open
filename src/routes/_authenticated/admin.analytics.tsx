import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/services/api";
import { toast } from "sonner";
import { AdminShell } from "@/components/lokalchat/AdminShell";
import {
  getAdminMetrics,
  getMyRole,
  getPlatformApiKey,
  savePlatformApiKey,
} from "@/services/api";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  component: AdminAccessGate,
  head: () => ({
    meta: [
      { title: "Analitik Admin — LokalChat" },
      {
        name: "description",
        content: "Gambaran keseluruhan semua SME di platform LokalChat.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function AdminAccessGate() {
  const navigate = useNavigate();
  const fetchRole = useApi(getMyRole);
  const roleQuery = useQuery({ queryKey: ["my-role"], queryFn: () => fetchRole(), retry: false });
  useEffect(() => {
    if (roleQuery.data && roleQuery.data.role !== "admin") void navigate({ to: "/dashboard", replace: true });
  }, [roleQuery.data, navigate]);
  if (roleQuery.isError) return <p role="alert" className="p-8">Gagal menyemak akses admin.</p>;
  if (roleQuery.data?.role !== "admin") return <p role="status" className="p-8">Menyemak akses…</p>;
  return <AdminAnalyticsPage />;
}

type RangeKey = "24h" | "7d" | "30d";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "24h", label: "24 Jam" },
  { key: "7d", label: "7 Hari" },
  { key: "30d", label: "30 Hari" },
];

const PROVIDER_OPTIONS = [
  { id: "gemini", label: "Gemini" },
  { id: "deepseek", label: "DeepSeek" },
];

function AdminAnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const fetchMetrics = useApi(getAdminMetrics);

  const metricsQuery = useQuery({
    queryKey: ["admin-metrics", range],
    queryFn: () => fetchMetrics({ data: { range } }),
  });

  const m = metricsQuery.data;
  const maxCount = Math.max(1, ...(m?.signupTrend ?? []).map((b) => b.count));
  const handoffPct = Math.round(m?.handoffRate ?? 0);
  const rangeLabel = RANGES.find((r) => r.key === range)!.label.toLowerCase();

  return (
    <AdminShell>
      {metricsQuery.isError && <p role="alert" className="mb-4 text-sm text-destructive">Gagal memuatkan analitik. <button type="button" onClick={() => metricsQuery.refetch()}>Cuba semula</button></p>}
      <div className="lc-topbar">
        <div>
          <h1>Analitik Admin</h1>
          <p>Gambaran keseluruhan semua SME di platform LokalChat.</p>
        </div>
        <div className="lc-range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={range === r.key ? "active" : ""}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="lc-metrics">
        <div className="lc-card">
          <div className="lc-card-label">
            SME Aktif
            <div className="lc-icon-chip green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
              </svg>
            </div>
          </div>
          <div className="lc-card-value">
            {metricsQuery.isPending ? "—" : (m?.activeSmes ?? 0)}
          </div>
          <div className="lc-card-sub">
            SME dengan sekurang-kurangnya satu mesej dalam {rangeLabel} lepas
          </div>
        </div>

        <div className="lc-card">
          <div className="lc-card-label">
            SME Senyap
            <div className="lc-icon-chip warn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12h8" />
              </svg>
            </div>
          </div>
          <div className="lc-card-value">
            {metricsQuery.isPending ? "—" : (m?.silentSmes ?? 0)}
            <span className="lc-card-unit"> SME</span>
            <span className="lc-delta warn">tiada aktiviti &gt;14 hari</span>
          </div>
          <div className="lc-card-sub">berisiko churn — perlu susulan</div>
        </div>

        <div className="lc-card">
          <div className="lc-card-label">
            Jumlah Mesej Auto-Jawab
            <div className="lc-icon-chip teal">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.1 9.1 0 0 1-3.3-.6L3 21l1.8-4.6A8.3 8.3 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1h.5A8.4 8.4 0 0 1 21 11.5z" />
              </svg>
            </div>
          </div>
          <div className="lc-card-value">
            {metricsQuery.isPending ? "—" : (m?.autoAnswered ?? 0).toLocaleString("ms-MY")}
          </div>
          <div className="lc-card-sub">merentasi semua SME, {rangeLabel} lepas</div>
        </div>
      </div>

      <div className="lc-charts">
        <div className="lc-panel">
          <div className="lc-panel-head">
            <h2>Trend Pendaftaran SME</h2>
            <span>{rangeLabel}</span>
          </div>
          <p className="lc-panel-sub">Bilangan SME baru mendaftar setiap tempoh.</p>
          <div className="lc-bars">
            {(m?.signupTrend ?? []).map((b, i) => (
              <div className="lc-bar-col" key={`${b.label}-${i}`}>
                <div
                  className="lc-bar"
                  style={{ height: `${Math.max(4, (b.count / maxCount) * 100)}%` }}
                  title={`${b.count} SME`}
                />
                <span className="lc-bar-label">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lc-panel">
          <div className="lc-panel-head">
            <h2>Kadar Handoff</h2>
          </div>
          <p className="lc-panel-sub">Purata merentasi semua SME.</p>
          <div className="lc-donut-wrap">
            <div
              className="lc-donut"
              style={{
                background: `conic-gradient(var(--primary) 0% ${handoffPct}%, var(--surface-alt) ${handoffPct}% 100%)`,
              }}
            >
              <div className="lc-donut-inner">
                <b>{metricsQuery.isPending ? "—" : `${handoffPct}%`}</b>
                <span>HANDOFF</span>
              </div>
            </div>
            <p className="lc-donut-caption">
              AI berjaya kendali <b>{100 - handoffPct}%</b> perbualan tanpa bantuan manusia
            </p>
          </div>
        </div>
      </div>

      <PlatformApiKeySection />
    </AdminShell>
  );
}

function PlatformApiKeySection() {
  const queryClient = useQueryClient();
  const fetchKey = useApi(getPlatformApiKey);
  const saveKey = useApi(savePlatformApiKey);

  const [provider, setProvider] = useState("gemini");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const keyQuery = useQuery({ queryKey: ["platform-api-key"], queryFn: fetchKey });
  const active = keyQuery.data;

  useEffect(() => {
    if (active?.provider) setProvider(active.provider);
  }, [active?.provider]);

  const saveMutation = useMutation({
    mutationFn: () => saveKey({ data: { provider, apiKey: apiKey.trim() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-api-key"] });
      setApiKey("");
      setShowForm(false);
      toast.success("Kunci API berjaya disahkan dan disimpan");
    },
    onError: (error: Error) => toast.error(error.message || "Gagal menyimpan kunci API"),
  });

  const formVisible = showForm || !active;

  return (
    <section className="lc-api-section">
      <h2>Kunci API Platform</h2>
      <p>
        Kunci disahkan dan disimpan melalui backend. Hanya admin boleh mengubah kunci platform.
      </p>
      <p>
        Pilihan provider dalam <Link to="/dashboard/settings" hash="llm">Tetapan Perniagaan</Link> digunakan terlebih dahulu jika sudah disimpan.
      </p>

      {keyQuery.isError && <p role="alert">Gagal membaca status kunci. <button type="button" onClick={() => keyQuery.refetch()}>Cuba semula</button></p>}
      {active && (
        <div className="lc-status-row">
          <span className="name">
            {PROVIDER_OPTIONS.find((p) => p.id === active.provider)?.label ?? active.provider}
          </span>
          <span className="lc-badge ok">Disambung</span>
          <button
            type="button"
            className="lc-btn ghost"
            onClick={() => setShowForm((v) => !v)}
          >
            Kemas kini kunci
          </button>
        </div>
      )}

      {formVisible && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!apiKey.trim()) {
              toast.error("Kunci API diperlukan");
              return;
            }
            saveMutation.mutate();
          }}
        >
          <div className="lc-field">
            <label htmlFor="provider">Penyedia LLM</label>
            <select
              id="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="lc-field">
            <label htmlFor="api-key">Kunci API</label>
            <div className="lc-field-row">
              <input
                id="api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                autoComplete="new-password"
                placeholder="••••••••••••••••••••"
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button
                type="button"
                className="lc-eye-btn"
                aria-label={showKey ? "Sembunyikan kunci" : "Papar kunci"}
                onClick={() => setShowKey((v) => !v)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            <p className="lc-field-hint">
              Kunci dihantar kepada backend untuk pengesahan dan penyimpanan selamat.
            </p>
          </div>

          <button type="submit" className="lc-btn primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Menguji kunci…" : "Uji & Simpan Kunci"}
          </button>
        </form>
      )}
    </section>
  );
}

