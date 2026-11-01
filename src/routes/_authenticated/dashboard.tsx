import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/services/api";
import { ConsoleShell } from "@/components/lokalchat/ConsoleShell";
import { SetupChecklist } from "@/components/lokalchat/SetupChecklist";
import { getDashboardMetrics } from "@/services/api";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Dashboard Prestasi AI — LokalChat" },
      {
        name: "description",
        content:
          "Pantau mesej auto-dijawab, masa dijimatkan dan kadar handoff AI WhatsApp kedai anda.",
      },
      { property: "og:title", content: "Dashboard Prestasi AI — LokalChat" },
      {
        property: "og:description",
        content:
          "Pantau mesej auto-dijawab, masa dijimatkan dan kadar handoff AI WhatsApp kedai anda.",
      },
    ],
  }),
});

type RangeKey = "24h" | "7d" | "30d";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "24h", label: "24 Jam" },
  { key: "7d", label: "7 Hari" },
  { key: "30d", label: "30 Hari" },
];

function formatDelta(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return { up: rounded >= 0, text: `${rounded >= 0 ? "+" : ""}${rounded}%` };
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return { value: `${m}`, unit: "minit" };
  return { value: `${h}j ${m}m`, unit: "" };
}

function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  const delta = formatDelta(value);
  if (!delta) return <span className="lc-delta">—</span>;
  const good = invert ? !delta.up : delta.up;
  return <span className={`lc-delta ${good ? "up" : "down"}`}>{delta.text}</span>;
}

function DashboardPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [openReason, setOpenReason] = useState<string | null>(null);
  const fetchMetrics = useApi(getDashboardMetrics);

  const metricsQuery = useQuery({
    queryKey: ["dashboard-metrics", range],
    queryFn: () => fetchMetrics({ data: { range } }),
  });

  const m = metricsQuery.data;
  const saved = formatDuration(m?.savedMinutes ?? 0);

  return (
    <ConsoleShell>
      {metricsQuery.isError && <p role="alert" className="mb-4 text-sm text-destructive">Gagal memuatkan prestasi. <button type="button" onClick={() => metricsQuery.refetch()}>Cuba semula</button></p>}
      <div className="lc-topbar">
        <div>
          <h1>Prestasi Ejen AI</h1>
          <p>Ringkasan automasi WhatsApp kedai anda</p>
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

      <SetupChecklist />

      <div className="lc-metrics">
        <div className="lc-card">
          <div className="lc-card-label">
            Mesej Auto-Dijawab
            <Delta value={m?.autoAnsweredDelta ?? null} />
          </div>
          <div className="lc-card-value">
            {metricsQuery.isPending ? "—" : (m?.autoAnswered ?? 0)}
            <span className="lc-card-unit"> mesej</span>
          </div>
          <div className="lc-card-sub">
            Daripada {m?.totalMessages ?? 0} mesej keseluruhan
          </div>
        </div>

        <div className="lc-card">
          <div className="lc-card-label">
            Masa Dijimatkan
            <Delta value={m?.savedDelta ?? null} />
          </div>
          <div className="lc-card-value">
            {metricsQuery.isPending ? "—" : saved.value}
            {saved.unit ? <span className="lc-card-unit"> {saved.unit}</span> : null}
          </div>
          <div className="lc-card-sub">
            Sesi dikendalikan sepenuhnya oleh bot
          </div>
        </div>

        <div className="lc-card">
          <div className="lc-card-label">
            Kadar Handoff
            <Delta value={m?.handoffRateDelta ?? null} invert />
          </div>
          <div className="lc-card-value">
            {metricsQuery.isPending ? "—" : Math.round(m?.handoffRate ?? 0)}
            <span className="lc-card-unit">%</span>
          </div>
          <div className="lc-card-sub">
            {m?.handoffSessions ?? 0} daripada {m?.totalSessions ?? 0} sesi
          </div>
        </div>
      </div>

      <div className="lc-section-head">
        <h2>Analisis Handoff</h2>
        <span>{m?.totalHandoffs ?? 0} handoff</span>
      </div>
      <p className="lc-section-desc">
        Sebab utama AI menyerahkan perbualan kepada manusia. Klik untuk lihat cadangan tindakan.
      </p>

      <div className="lc-insights">
        {metricsQuery.isPending ? (
          <div className="lc-insight">
            <div className="lc-insight-top">
              <span className="lc-insight-title">Memuatkan data…</span>
            </div>
          </div>
        ) : (m?.reasons.length ?? 0) === 0 ? (
          <div className="lc-insight">
            <div className="lc-insight-top">
              <span className="lc-insight-title">Tiada handoff dalam tempoh ini 🎉</span>
            </div>
          </div>
        ) : (
          m!.reasons.map((r) => {
            const open = openReason === r.reason;
            return (
              <div key={r.reason} className={`lc-insight${open ? " open" : ""}`}>
                <button
                  type="button"
                  className="lc-insight-top"
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
                  onClick={() => setOpenReason(open ? null : r.reason)}
                >
                  <span className={`lc-sev ${r.percent >= 30 ? "high" : "mid"}`} />
                  <span className="lc-insight-title">{r.reason}</span>
                  <span className="lc-insight-pct">{Math.round(r.percent)}%</span>
                  <span className="lc-chev">▶</span>
                </button>
                <div className="lc-insight-body">
                  <div className="lc-action">
                    <b>Cadangan tindakan:</b>{" "}
                    {r.action ?? "Tiada cadangan direkodkan untuk sebab ini."}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </ConsoleShell>
  );
}

