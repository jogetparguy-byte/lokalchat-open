import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/services/api";
import { getSetupChecklist, updateSetupChecklist } from "@/services/api";

type StepKey = "business" | "knowledge" | "tested" | "whatsapp";

const STEPS: {
  key: StepKey;
  title: string;
  desc: string;
  to: "/dashboard/settings" | "/dashboard/knowledge-base" | "/dashboard/inbox";
  hash?: string;
}[] = [
  { key: "business", title: "Isi maklumat bisnes", desc: "Masukkan nama bisnes anda.", to: "/dashboard/settings" },
  { key: "knowledge", title: "Tambah FAQ & system prompt", desc: "Muat naik fail atau tulis system prompt.", to: "/dashboard/knowledge-base" },
  { key: "tested", title: "Cuba bot anda", desc: "Hantar satu mesej ujian melalui simulator.", to: "/dashboard/inbox" },
  { key: "whatsapp", title: "Sambung WhatsApp", desc: "Sambungkan nombor WhatsApp Business anda.", to: "/dashboard/settings", hash: "whatsapp" },
];

export function SetupChecklist() {
  const qc = useQueryClient();
  const fetchChecklist = useApi(getSetupChecklist);
  const update = useApi(updateSetupChecklist);
  const q = useQuery({ queryKey: ["setup-checklist"], queryFn: () => fetchChecklist() });
  const mut = useMutation({
    mutationFn: (action: "dismiss" | "celebrated") => update({ data: { action } }),
  });
  const celebrateSent = useRef(false);

  const d = q.data;
  const showCelebration = !!d?.allDone && !d.celebrated;

  useEffect(() => {
    if (showCelebration && !celebrateSent.current) {
      celebrateSent.current = true;
      mut.mutate("celebrated");
    }
  }, [showCelebration, mut]);

  if (!d) return null;
  if (d.allDone && !showCelebration) return null;

  if (showCelebration) {
    return (
      <div className="lc-setup lc-setup-done">
        <div className="lc-setup-check done">✓</div>
        <div>
          <h2>Bot anda sudah hidup!</h2>
          <p>Semua langkah persediaan selesai. Pelanggan kini boleh berbual dengan ejen AI anda.</p>
        </div>
      </div>
    );
  }
  if (d.dismissed) return null;

  const doneCount = STEPS.filter((s) => d.steps[s.key]).length;
  const firstOpen = STEPS.findIndex((s) => !d.steps[s.key]);

  return (
    <div className="lc-setup">
      <div className="lc-setup-head">
        <div>
          <h2>Setup Checklist</h2>
          <p>{doneCount} daripada 4 langkah siap</p>
        </div>
        <button
          type="button"
          className="lc-setup-close"
          aria-label="Tutup checklist"
          disabled={mut.isPending}
          onClick={() =>
            mut.mutate("dismiss", {
              onSuccess: () => qc.invalidateQueries({ queryKey: ["setup-checklist"] }),
            })
          }
        >
          ×
        </button>
      </div>
      <div className="lc-setup-bar">
        <div style={{ width: `${(doneCount / 4) * 100}%` }} />
      </div>
      <ol className="lc-setup-steps">
        {STEPS.map((s, i) => {
          const done = d.steps[s.key];
          const locked = !done && i > 0 && !d.steps[STEPS[i - 1]!.key];
          const isNext = i === firstOpen;
          return (
            <li key={s.key} className={`lc-setup-step${done ? " done" : ""}${locked ? " locked" : ""}`}>
              <span className={`lc-setup-check${done ? " done" : ""}`}>{done ? "✓" : i + 1}</span>
              <div className="lc-setup-text">
                <b>{s.title}</b>
                <span>{locked ? "Siapkan langkah sebelumnya dahulu." : s.desc}</span>
              </div>
              {isNext && !locked ? (
                <Link to={s.to} {...(s.hash ? { hash: s.hash } : {})} className="lc-btn primary lc-setup-cta">
                  Teruskan
                </Link>
              ) : !done && !locked ? (
                <Link to={s.to} {...(s.hash ? { hash: s.hash } : {})} className="lc-setup-link">
                  Buka
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

