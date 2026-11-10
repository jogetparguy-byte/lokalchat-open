import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Settings,
  Palette,
  Languages,
  SlidersHorizontal,
  Plug,
  Bell,
  Shield,
  CircleHelp,
} from "lucide-react";
import { ConsoleShell } from "@/components/lokalchat/ConsoleShell";
import { LlmSettingsSection } from "@/components/lokalchat/LlmSettingsSection";
import { SupabaseSettingsSection } from "@/components/lokalchat/SupabaseSettingsSection";
import { WhatsappConnectionSection } from "@/components/lokalchat/WhatsappConnectionSection";
import { SettingsDirtyProvider } from "@/components/lokalchat/SettingsDirtyContext";
import {
  SettingsBlock,
  ProfileField,
  AppearancePanel,
  LanguagePanel,
  NotificationsPanel,
  AccountPanel,
} from "@/components/lokalchat/SettingsPanels";
import { usePreferences } from "@/components/lokalchat/usePreferences";

export const Route = createFileRoute("/_authenticated/dashboard_/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [{ title: "Settings — LokalChat" }],
    links: [{ rel: "canonical", href: "/dashboard/settings" }],
  }),
});

const AREAS = [
  { id: "general", ms: "Umum", en: "General", icon: Settings },
  { id: "appearance", ms: "Rupa", en: "Appearance", icon: Palette },
  {
    id: "language",
    ms: "Bahasa & rantau",
    en: "Language & region",
    icon: Languages,
  },
  {
    id: "configuration",
    ms: "Konfigurasi",
    en: "Configuration",
    icon: SlidersHorizontal,
  },
  { id: "integrations", ms: "Integrasi", en: "Integrations", icon: Plug },
  { id: "notifications", ms: "Notifikasi", en: "Notifications", icon: Bell },
  {
    id: "account",
    ms: "Akaun & keselamatan",
    en: "Account & security",
    icon: Shield,
  },
  {
    id: "about",
    ms: "Tentang & bantuan",
    en: "About & help",
    icon: CircleHelp,
  },
] as const;
type Area = (typeof AREAS)[number]["id"];
function areaFromHash(hash: string): Area {
  const id = hash.replace(/^#/, "");
  if (id === "llm" || id === "supabase") return "configuration";
  if (id === "whatsapp") return "integrations";
  return AREAS.find((area) => area.id === id)?.id ?? "general";
}

export function SettingsPage() {
  const { t } = usePreferences();
  const [active, setActive] = useState<Area>("general");
  const [visited, setVisited] = useState<Set<Area>>(new Set(["general"]));
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const dirtyRef = useRef(false);
  const anyDirty = Object.values(dirty).some(Boolean);
  dirtyRef.current = anyDirty;
  const reportDirty = useCallback(
    (id: string, value: boolean) =>
      setDirty((current) =>
        current[id] === value ? current : { ...current, [id]: value },
      ),
    [],
  );
  useBlocker({
    shouldBlockFn: () =>
      dirtyRef.current &&
      !window.confirm(
        t(
          "Perubahan belum disimpan. Tinggalkan Settings dan buang draf?",
          "You have unsaved changes. Leave Settings and discard drafts?",
        ),
      ),
    enableBeforeUnload: () => dirtyRef.current,
  });
  useEffect(() => {
    const initial = areaFromHash(window.location.hash);
    setActive(initial);
    setVisited((current) => new Set([...current, initial]));
    const onHash = () => {
      const next = areaFromHash(window.location.hash);
      setActive(next);
      setVisited((current) => new Set([...current, next]));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  function selectArea(next: Area) {
    if (next === active) return;
    if (
      anyDirty &&
      !window.confirm(
        t(
          "Ada perubahan belum disimpan. Tukar section? Draf kekal sehingga anda meninggalkan Settings.",
          "You have unsaved changes. Switch section? Drafts stay until you leave Settings.",
        ),
      )
    )
      return;
    setActive(next);
    setVisited((current) => new Set([...current, next]));
    window.history.replaceState(window.history.state, "", `#${next}`);
    requestAnimationFrame(() => heading.current?.focus());
  }
  const area = AREAS.find((item) => item.id === active)!;
  const descriptions: Record<Area, string> = {
    general: t("Maklumat asas perniagaan anda.", "Your business details."),
    appearance: t(
      "Sesuaikan ruang kerja LokalChat.",
      "Make your LokalChat workspace yours.",
    ),
    language: t(
      "Bahasa, waktu dan format yang anda gunakan.",
      "The language, time and formats you use.",
    ),
    configuration: t(
      "Sediakan AI dan backend untuk pemasangan LokalChat ini.",
      "Set up AI and the backend for this LokalChat installation.",
    ),
    integrations: t(
      "Sambungkan saluran pelanggan dan inventori kedai.",
      "Connect your customer channel and store inventory.",
    ),
    notifications: t(
      "Urus laporan perniagaan yang anda terima.",
      "Manage the business reports you receive.",
    ),
    account: t(
      "Profil, kata laluan dan sesi login anda.",
      "Your profile, password and sign-in sessions.",
    ),
    about: t(
      "Maklumat pemasangan dan panduan LokalChat.",
      "Installation details and LokalChat guides.",
    ),
  };
  return (
    <ConsoleShell>
      <SettingsDirtyProvider onChange={reportDirty}>
        <div className="lc-settings" data-ui>
          <div className="lc-settings-mobile">
            <label htmlFor="settings-area">{t("Tetapan", "Settings")}</label>
            <select
              id="settings-area"
              value={active}
              onChange={(e) => selectArea(e.target.value as Area)}
            >
              {AREAS.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.ms, item.en)}
                </option>
              ))}
            </select>
          </div>
          <nav
            className="lc-settings-nav"
            aria-label={t("Section tetapan", "Settings sections")}
          >
            <p>{t("Tetapan", "Settings")}</p>
            {AREAS.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-current={active === item.id ? "page" : undefined}
                aria-controls={`settings-${item.id}`}
                onClick={() => selectArea(item.id)}
              >
                <item.icon size={17} strokeWidth={1.6} aria-hidden="true" />
                {t(item.ms, item.en)}
              </button>
            ))}
          </nav>
          <div className="lc-settings-content">
            <header className="lc-settings-title">
              <h1 ref={heading} tabIndex={-1}>
                {t(area.ms, area.en)}
              </h1>
              <p>{descriptions[active]}</p>
              {anyDirty && (
                <p role="status" className="lc-settings-unsaved">
                  {t(
                    "Ada perubahan belum disimpan.",
                    "You have unsaved changes.",
                  )}
                </p>
              )}
            </header>
            {AREAS.map(
              (item) =>
                visited.has(item.id) && (
                  <div
                    key={item.id}
                    id={`settings-${item.id}`}
                    hidden={active !== item.id}
                  >
                    {item.id === "general" && (
                      <SettingsBlock
                        title={t("Maklumat perniagaan", "Business details")}
                      >
                        <ProfileField field="businessName" />
                      </SettingsBlock>
                    )}
                    {item.id === "appearance" && <AppearancePanel />}
                    {item.id === "language" && <LanguagePanel />}
                    {item.id === "configuration" && (
                      <>
                        <p className="lc-settings-note">
                          {t(
                            "Konfigurasi ini dikongsi semua akaun pada pemasangan sama. Semua pengguna login boleh menyimpannya.",
                            "These settings are shared by all accounts on this installation. Any signed-in user can save them.",
                          )}
                        </p>
                        <LlmSettingsSection />
                        <SupabaseSettingsSection />
                      </>
                    )}
                    {item.id === "integrations" && (
                      <>
                        <WhatsappConnectionSection />
                        <SettingsBlock title={t("Inventori", "Inventory")}>
                          <ProfileField field="inventoryApiUrl" />
                        </SettingsBlock>
                      </>
                    )}
                    {item.id === "notifications" && <NotificationsPanel />}
                    {item.id === "account" && <AccountPanel />}
                    {item.id === "about" && <AboutPanel />}
                  </div>
                ),
            )}
          </div>
        </div>
      </SettingsDirtyProvider>
    </ConsoleShell>
  );
}

function AboutPanel() {
  const { t } = usePreferences();
  return (
    <>
      <SettingsBlock
        title="LokalChat"
        description={t(
          "Pembantu AI WhatsApp untuk perniagaan anda.",
          "Your business’s WhatsApp AI assistant.",
        )}
      >
        <dl className="lc-settings-about">
          <div>
            <dt>{t("Versi", "Version")}</dt>
            <dd>
              {import.meta.env["VITE_APP_VERSION"] ||
                t(
                  "Build lokal (versi belum ditetapkan)",
                  "Local build (version not set)",
                )}
            </dd>
          </div>
          <div>
            <dt>{t("Mod", "Mode")}</dt>
            <dd>{import.meta.env.DEV ? "Development" : "Production"}</dd>
          </div>
        </dl>
      </SettingsBlock>
      <section className="lc-settings-support" aria-labelledby="lokalchat-support-title">
        <div>
          <h2 id="lokalchat-support-title">Support LokalChat</h2>
          <p>
            {t(
              "Bantu menyokong pembangunan LokalChat.",
              "Help support the development of LokalChat.",
            )}
          </p>
          <p id="lokalchat-donate-status" className="lc-settings-support-status">
            {t(
              "Sumbangan belum tersedia. Pilihan bayaran akan ditambah nanti.",
              "Donations are not available yet. Payment options are coming soon.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="lc-settings-donate"
          disabled
          aria-describedby="lokalchat-donate-status"
        >
          Donate
        </button>
      </section>
      <SettingsBlock title={t("Panduan & bantuan", "Guides & help")}>
        <a
          className="lc-settings-help-link"
          href="https://github.com/jogetparguy-byte/lokalchat-open/blob/main/docs/INSTALL.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Panduan pemasangan", "Installation guide")}
        </a>
        <a
          className="lc-settings-help-link"
          href="https://github.com/jogetparguy-byte/lokalchat-open/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Laporkan masalah", "Report an issue")}
        </a>
        <details>
          <summary>
            {t(
              "Bagaimana mengaktifkan WhatsApp?",
              "How do I connect WhatsApp?",
            )}
          </summary>
          <p>
            {t(
              "Buka Integrasi, isi kredensial WhatsApp Business dan ikut panduan webhook. Gunakan Uji & Simpan Sambungan.",
              "Open Integrations, enter WhatsApp Business credentials and follow the webhook guide. Use Test & Save Connection.",
            )}
          </p>
        </details>
        <details>
          <summary>
            {t(
              "Bilakah konfigurasi digunakan?",
              "When do configuration changes apply?",
            )}
          </summary>
          <p>
            {t(
              "Provider AI digunakan pada balasan seterusnya. Perubahan Supabase memerlukan restart; production memerlukan build semula dan restart. Data tidak dipindahkan ke projek baharu.",
              "AI changes apply to subsequent replies. Supabase changes require a restart; production requires a rebuild and restart. Data is not migrated to a new project.",
            )}
          </p>
        </details>
      </SettingsBlock>
    </>
  );
}

