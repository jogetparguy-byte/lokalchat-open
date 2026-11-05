import { accountPreferences } from "@/lib/preferences";
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { summarize, type MsgRow, type HandoffRow } from "@/lib/metrics";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function buildReportText(name: string, autoAnswered: number, savedMs: number, rate: number) {
  const hours = (savedMs / 3_600_000).toFixed(1);
  return [
    `📊 Laporan Mingguan LokalChat untuk ${name}`,
    `• ${autoAnswered} soalan dijawab automatik`,
    `• ${hours} jam dijimatkan`,
    `• ${Math.round(rate)}% kadar handoff`,
    "",
    "(7 hari lepas)",
  ].join("\n");
}

export const Route = createFileRoute("/api/public/hooks/weekly-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendWhatsAppMessage } = await import("@/lib/whatsapp.server");

        const token = request.headers.get("x-report-token") ?? "";
        const { data: setting } = await supabaseAdmin
          .from("internal_settings")
          .select("value")
          .eq("key", "weekly_report_token")
          .maybeSingle();
        if (!setting?.value || !token || !safeEqual(token, setting.value)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const since = new Date(Date.now() - WEEK_MS).toISOString();
        // Skip anyone already reported in the last 6 days (idempotent re-runs).
        const dedupe = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

        const { data: profiles, error } = await supabaseAdmin
          .from("profiles")
          .select("id, business_name, owner_whatsapp, weekly_report_sent_at")
          .not("owner_whatsapp", "is", null);
        if (error) return new Response(error.message, { status: 500 });

        let sent = 0;
        for (const p of profiles ?? []) {
          if (p.weekly_report_sent_at && p.weekly_report_sent_at > dedupe) continue;
          try {
            const { data: owner, error: ownerError } = await supabaseAdmin.auth.admin.getUserById(p.id);
            // Fail closed if preferences cannot be read; never send an opted-out report.
            if (ownerError || !owner.user || !accountPreferences(owner.user.user_metadata).weeklyReport) continue;
            const [{ data: msgs }, { data: handoffs }] = await Promise.all([
              supabaseAdmin
                .from("messages")
                .select("chat_id, created_at, chats!inner(business_id)")
                .eq("chats.business_id", p.id)
                .gte("created_at", since)
                .limit(20000),
              supabaseAdmin
                .from("handoff_events")
                .select("chat_id, created_at, ai_reason, ai_suggested_action")
                .eq("business_id", p.id)
                .gte("created_at", since)
                .limit(5000),
            ]);
            const m = summarize((msgs ?? []) as MsgRow[], (handoffs ?? []) as HandoffRow[]);
            if (m.totalMessages === 0) continue;

            const text = buildReportText(p.business_name, m.autoAnswered, m.savedMs, m.handoffRate);
            const result = await sendWhatsAppMessage(p.owner_whatsapp!, text, p.id);
            if (!result.ok) {
              console.error("weekly report send failed for", p.id, result.error);
              continue;
            }
            await supabaseAdmin
              .from("profiles")
              .update({ weekly_report_sent_at: new Date().toISOString() })
              .eq("id", p.id);
            sent += 1;
          } catch (e) {
            console.error("weekly report failed for", p.id, e);
          }
        }

        return Response.json({ ok: true, sent });
      },
    },
  },
});

