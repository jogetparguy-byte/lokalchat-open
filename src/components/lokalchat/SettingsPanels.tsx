import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getProfile, updateProfile, useApi } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "./ThemeProvider";
import { usePreferences } from "./usePreferences";
import { useSettingsDirty } from "./SettingsDirtyContext";
import {
  accountPreferences,
  SIDEBAR_KEY,
  formatDate as formatPreferenceDate,
  type ReplyLanguage,
} from "@/lib/preferences";

export function SettingsBlock({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="lc-settings-block">
      <h2>{title}</h2>
      {description && <p className="lc-settings-description">{description}</p>}
      <div className="lc-settings-fields">{children}</div>
    </section>
  );
}

export function useSettingsUser() {
  return useQuery({
    queryKey: ["settings-user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data.user)
        throw new Error("Sila login semula / Please sign in again");
      return data.user;
    },
    retry: false,
  });
}

export function ProfileField({
  field,
}: {
  field: "businessName" | "inventoryApiUrl" | "ownerWhatsapp";
}) {
  const { t } = usePreferences();
  const fetchProfile = useApi(getProfile);
  const query = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  if (query.isPending)
    return <p role="status">{t("Memuatkan maklumat…", "Loading details…")}</p>;
  if (query.isError) return <LoadError retry={() => query.refetch()} />;
  const profile = query.data;
  const initial =
    field === "businessName"
      ? (profile?.business_name ?? "")
      : field === "inventoryApiUrl"
        ? (profile?.inventory_api_url ?? "")
        : (profile?.owner_whatsapp ?? "");
  return <ProfileFieldForm field={field} initial={initial} />;
}

function ProfileFieldForm({
  field,
  initial,
}: {
  field: "businessName" | "inventoryApiUrl" | "ownerWhatsapp";
  initial: string;
}) {
  const { t } = usePreferences();
  const client = useQueryClient();
  const saveProfile = useApi(updateProfile);
  const [value, setValue] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useSettingsDirty(value !== baseline);
  const label =
    field === "businessName"
      ? t("Nama perniagaan", "Business name")
      : field === "inventoryApiUrl"
        ? t("URL API inventori (pilihan)", "Inventory API URL (optional)")
        : t("WhatsApp penerima laporan", "Report recipient WhatsApp");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setSaved(false);
    try {
      await saveProfile({ data: { [field]: value.trim() } });
      setValue(value.trim());
      setBaseline(value.trim());
      setSaved(true);
      await client.invalidateQueries({ queryKey: ["profile"] });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="lc-settings-form">
      <fieldset disabled={pending}>
        <Label htmlFor={field}>{label}</Label>
        <Input
          id={field}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          required={field === "businessName"}
          maxLength={
            field === "businessName"
              ? 100
              : field === "ownerWhatsapp"
                ? 24
                : 2048
          }
          type={field === "inventoryApiUrl" ? "url" : "text"}
          inputMode={field === "ownerWhatsapp" ? "tel" : undefined}
          placeholder={
            field === "ownerWhatsapp"
              ? "60123456789"
              : field === "inventoryApiUrl"
                ? "https://api.kedaisaya.com/stock"
                : undefined
          }
          aria-describedby={`${field}-help`}
        />
        <p id={`${field}-help`} className="lc-settings-help">
          {field === "businessName"
            ? t(
                "Nama kedai yang digunakan oleh LokalChat.",
                "The business name used by LokalChat.",
              )
            : field === "inventoryApiUrl"
              ? t(
                  "AI menggunakan endpoint ini untuk menyemak stok secara langsung.",
                  "AI uses this endpoint to check live stock availability.",
                )
              : t(
                  "Masukkan kod negara tanpa tanda +. Kosongkan untuk menghentikan penghantaran ke nombor ini.",
                  "Include the country code without +. Clear this field to stop delivery to this number.",
                )}
        </p>
        <Button type="submit">
          {pending ? t("Menyimpan…", "Saving…") : t("Simpan", "Save")}
        </Button>
      </fieldset>
      <Feedback error={error} saved={saved} />
    </form>
  );
}

export function AppearancePanel() {
  const { t } = usePreferences();
  const { theme, setTheme } = useTheme();
  const [choice, setChoice] = useState(theme);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [baseline, setBaseline] = useState({ theme, collapsed });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useSettingsDirty(
    choice !== baseline.theme || collapsed !== baseline.collapsed,
  );
  useEffect(() => {
    if (choice === baseline.theme && theme !== baseline.theme) {
      setChoice(theme);
      setBaseline((current) => ({ ...current, theme }));
    }
  }, [theme, choice, baseline.theme]);
  return (
    <SettingsBlock
      title={t("Rupa aplikasi", "Application appearance")}
      description={t(
        "Pilihan ini disimpan pada browser ini.",
        "These preferences are saved in this browser.",
      )}
    >
      <form
        className="lc-settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setSaved(false);
          try {
            localStorage.setItem(SIDEBAR_KEY, String(collapsed));
            localStorage.setItem("lokalchat-theme", choice);
            setTheme(choice);
            window.dispatchEvent(new Event("lokalchat-sidebar-change"));
            setBaseline({ theme: choice, collapsed });
            setSaved(true);
          } catch {
            setError(
              t(
                "Browser tidak membenarkan simpanan pilihan.",
                "Your browser blocked preference storage.",
              ),
            );
          }
        }}
      >
        <fieldset onChange={() => setSaved(false)}>
          <Label htmlFor="theme-choice">{t("Tema", "Theme")}</Label>
          <select
            id="theme-choice"
            value={choice}
            onChange={(e) => setChoice(e.target.value as typeof theme)}
          >
            <option value="light">{t("Cerah", "Light")}</option>
            <option value="dark">{t("Gelap", "Dark")}</option>
          </select>
          <div className="lc-settings-preview" data-preview-theme={choice}>
            <span>LokalChat</span>
            <span>{t("Pratonton tema", "Theme preview")}</span>
            <div />
            <div />
          </div>
          <label className="lc-settings-switch">
            <span>
              {t("Sembunyikan sidebar dashboard", "Collapse dashboard sidebar")}
              <small>
                {t(
                  "Boleh dibuka semula melalui butang Navigasi atau Ctrl+B / ⌘B.",
                  "Reopen with Navigation or Ctrl+B / ⌘B.",
                )}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={collapsed}
              onChange={(e) => setCollapsed(e.target.checked)}
            />
          </label>
          <Button type="submit">{t("Simpan rupa", "Save appearance")}</Button>
        </fieldset>
        <Feedback error={error} saved={saved} />
      </form>
    </SettingsBlock>
  );
}

export function LanguagePanel() {
  const { preferences, savePreferences, t } = usePreferences();
  const [draft, setDraft] = useState(preferences);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useSettingsDirty(JSON.stringify(draft) !== JSON.stringify(preferences));
  const user = useSettingsUser();
  const zones = Array.from(
    new Set([draft.timeZone, ...Intl.supportedValuesOf("timeZone"), "UTC"]),
  );
  return (
    <>
      <SettingsBlock
        title={t("Bahasa & rantau", "Language & region")}
        description={t(
          "Bahasa antaramuka, zon waktu dan format tarikh pada browser ini.",
          "Interface language, time zone and date format for this browser.",
        )}
      >
        <form
          className="lc-settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            try {
              savePreferences(draft);
              setSaved(true);
            } catch {
              setError(
                t(
                  "Pilihan tidak dapat disimpan pada browser.",
                  "Preferences could not be saved in this browser.",
                ),
              );
            }
          }}
        >
          <fieldset onChange={() => setSaved(false)}>
            <Label htmlFor="interface-language">
              {t("Bahasa antaramuka", "Interface language")}
            </Label>
            <select
              id="interface-language"
              value={draft.language}
              onChange={(e) =>
                setDraft({ ...draft, language: e.target.value as "ms" | "en" })
              }
            >
              <option value="ms">Bahasa Melayu</option>
              <option value="en">English</option>
            </select>
            <Label htmlFor="time-zone">{t("Zon waktu", "Time zone")}</Label>
            <select
              id="time-zone"
              value={draft.timeZone}
              onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
            >
              {zones.map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
            <Label htmlFor="date-format">
              {t("Format tarikh", "Date format")}
            </Label>
            <select
              id="date-format"
              value={draft.dateFormat}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  dateFormat: e.target.value as typeof draft.dateFormat,
                })
              }
            >
              <option value="dmy">DD/MM/YYYY</option>
              <option value="mdy">MM/DD/YYYY</option>
              <option value="iso">YYYY-MM-DD</option>
            </select>
            <p className="lc-settings-help">
              {t("Pratonton format", "Format preview")}:{" "}
              {formatPreferenceDate("2026-11-03T01:30:00Z", draft)}
            </p>
            <Button type="submit">
              {t("Simpan bahasa & rantau", "Save language & region")}
            </Button>
          </fieldset>
          <Feedback error={error} saved={saved} />
        </form>
      </SettingsBlock>
      <SettingsBlock
        title={t("Bahasa balasan AI", "AI reply language")}
        description={t(
          "Pilihan berasingan untuk pelanggan anda. Digunakan pada balasan AI seterusnya.",
          "A separate preference for your customers. Applies to subsequent AI replies.",
        )}
      >
        {user.isPending ? (
          <p role="status">{t("Memuatkan…", "Loading…")}</p>
        ) : user.isError ? (
          <LoadError retry={() => user.refetch()} />
        ) : (
          <AccountPreferenceForm
            kind="reply"
            metadata={user.data.user_metadata}
          />
        )}
      </SettingsBlock>
    </>
  );
}

export function NotificationsPanel() {
  const { t } = usePreferences();
  const user = useSettingsUser();
  return (
    <>
      <SettingsBlock
        title={t("Laporan mingguan", "Weekly report")}
        description={t(
          "Ringkasan soalan dijawab AI, masa dijimatkan dan kadar handoff melalui WhatsApp.",
          "A WhatsApp summary of AI answers, time saved and handoff rate.",
        )}
      >
        {user.isPending ? (
          <p role="status">{t("Memuatkan…", "Loading…")}</p>
        ) : user.isError ? (
          <LoadError retry={() => user.refetch()} />
        ) : (
          <AccountPreferenceForm
            kind="weekly"
            metadata={user.data.user_metadata}
          />
        )}
      </SettingsBlock>
      <SettingsBlock title={t("Penerima laporan", "Report recipient")}>
        <ProfileField field="ownerWhatsapp" />
      </SettingsBlock>
      <p className="lc-settings-note">
        {t(
          "Penghantaran mengikut job mingguan pemasangan anda. Tetapan zon waktu paparan tidak mengubah jadual server.",
          "Delivery follows your installation’s weekly job. Display time zone settings do not change the server schedule.",
        )}
      </p>
    </>
  );
}

function AccountPreferenceForm({
  kind,
  metadata,
}: {
  kind: "reply" | "weekly";
  metadata: Record<string, unknown>;
}) {
  const { t } = usePreferences();
  const client = useQueryClient();
  const initial = accountPreferences(metadata);
  const [reply, setReply] = useState<ReplyLanguage>(initial.replyLanguage);
  const [weekly, setWeekly] = useState(initial.weeklyReport);
  const [baseline, setBaseline] = useState(initial);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useSettingsDirty(
    kind === "reply"
      ? reply !== baseline.replyLanguage
      : weekly !== baseline.weeklyReport,
  );
  return (
    <form
      className="lc-settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setPending(true);
        setError("");
        setSaved(false);
        try {
          const { data, error } = await supabase.auth.updateUser({
            data:
              kind === "reply"
                ? { lokalchat_reply_language: reply }
                : { lokalchat_weekly_report: weekly },
          });
          if (error) throw error;
          if (data.user) client.setQueryData(["settings-user"], data.user);
          setBaseline({ replyLanguage: reply, weeklyReport: weekly });
          setSaved(true);
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} onChange={() => setSaved(false)}>
        {kind === "reply" ? (
          <>
            <Label htmlFor="reply-language">
              {t("Bahasa balasan", "Reply language")}
            </Label>
            <select
              id="reply-language"
              value={reply}
              onChange={(e) => setReply(e.target.value as ReplyLanguage)}
            >
              <option value="auto">
                {t("Ikut bahasa pelanggan", "Match customer language")}
              </option>
              <option value="ms">Bahasa Melayu</option>
              <option value="en">English</option>
            </select>
          </>
        ) : (
          <label className="lc-settings-switch">
            <span>
              {t("Terima laporan mingguan", "Receive weekly reports")}
              <small>
                {t(
                  "Memerlukan nombor penerima dan job mingguan yang aktif.",
                  "Requires a recipient number and an active weekly job.",
                )}
              </small>
            </span>
            <input
              role="switch"
              type="checkbox"
              checked={weekly}
              onChange={(e) => setWeekly(e.target.checked)}
            />
          </label>
        )}
        <Button type="submit">
          {pending ? t("Menyimpan…", "Saving…") : t("Simpan", "Save")}
        </Button>
      </fieldset>
      <Feedback error={error} saved={saved} />
    </form>
  );
}

export function AccountPanel() {
  const { t, formatDate } = usePreferences();
  const user = useSettingsUser();
  if (user.isPending)
    return <p role="status">{t("Memuatkan akaun…", "Loading account…")}</p>;
  if (user.isError) return <LoadError retry={() => user.refetch()} />;
  return (
    <>
      <SettingsBlock
        title={t("Profil pengguna", "User profile")}
        description={user.data.email ?? ""}
      >
        <AccountName
          initial={
            user.data.user_metadata["full_name"] ??
            user.data.user_metadata["name"] ??
            ""
          }
        />
        <p className="lc-settings-help">
          {t("Login terakhir", "Last sign in")}:{" "}
          {user.data.last_sign_in_at
            ? formatDate(user.data.last_sign_in_at)
            : "—"}
        </p>
      </SettingsBlock>
      <SettingsBlock
        title={t("Kata laluan", "Password")}
        description={t(
          "Gunakan sekurang-kurangnya 8 aksara. Polisi projek mungkin lebih ketat.",
          "Use at least 8 characters. Your project may require a stronger password.",
        )}
      >
        <PasswordForm />
      </SettingsBlock>
      <SettingsBlock
        title={t("Sesi login", "Login sessions")}
        description={t(
          "Tamatkan sesi pada peranti lain atau semua peranti. Access token sedia ada kekal sah sehingga tamat tempohnya.",
          "End sessions on other devices or all devices. Existing access tokens remain valid until expiry.",
        )}
      >
        <SessionActions />
      </SettingsBlock>
    </>
  );
}

function AccountName({ initial }: { initial: string }) {
  const { t } = usePreferences();
  const client = useQueryClient();
  const [name, setName] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useSettingsDirty(name !== baseline);
  return (
    <form
      className="lc-settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setPending(true);
        setError("");
        setSaved(false);
        try {
          const { data, error } = await supabase.auth.updateUser({
            data: { full_name: name.trim() },
          });
          if (error) throw error;
          if (data.user) client.setQueryData(["settings-user"], data.user);
          setName(name.trim());
          setBaseline(name.trim());
          setSaved(true);
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending}>
        <Label htmlFor="account-name">
          {t("Nama paparan", "Display name")}
        </Label>
        <Input
          id="account-name"
          value={name}
          required
          maxLength={100}
          autoComplete="name"
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
        <Button type="submit">
          {pending
            ? t("Menyimpan…", "Saving…")
            : t("Simpan profil", "Save profile")}
        </Button>
      </fieldset>
      <Feedback error={error} saved={saved} />
    </form>
  );
}

function PasswordForm() {
  const { t } = usePreferences();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nonce, setNonce] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  useSettingsDirty(Boolean(current || password || confirm || nonce));
  return (
    <form
      className="lc-settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setError("");
        setSaved(false);
        if (password !== confirm) {
          setError(
            t(
              "Pengesahan kata laluan tidak sepadan.",
              "Password confirmation does not match.",
            ),
          );
          return;
        }
        setPending(true);
        try {
          const { error } = await supabase.auth.updateUser({
            password,
            ...(current ? { current_password: current } : {}),
            ...(nonce ? { nonce } : {}),
          });
          if (error) throw error;
          setCurrent("");
          setPassword("");
          setConfirm("");
          setNonce("");
          setCodeSent(false);
          setSaved(true);
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} onChange={() => setSaved(false)}>
        <Label htmlFor="current-password">
          {t(
            "Kata laluan semasa (jika diperlukan projek)",
            "Current password (if required by your project)",
          )}
        </Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Label htmlFor="new-password">
          {t("Kata laluan baharu", "New password")}
        </Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Label htmlFor="confirm-password">
          {t("Sahkan kata laluan baharu", "Confirm new password")}
        </Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <details>
          <summary>
            {t("Perlu kod pengesahan?", "Need a verification code?")}
          </summary>
          <p className="lc-settings-help">
            {t(
              "Jika projek meminta pengesahan semula, hantar kod ke e-mel atau telefon akaun anda.",
              "If your project requires reauthentication, send a code to your account email or phone.",
            )}
          </p>
          <Button
            variant="outline"
            type="button"
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                const { error } = await supabase.auth.reauthenticate();
                if (error) throw error;
                setCodeSent(true);
              } catch (cause) {
                setError((cause as Error).message);
              } finally {
                setPending(false);
              }
            }}
          >
            {t("Hantar kod", "Send code")}
          </Button>
          {codeSent && (
            <p role="status">
              {t("Kod pengesahan dihantar.", "Verification code sent.")}
            </p>
          )}
          <Label htmlFor="password-nonce">
            {t("Kod pengesahan", "Verification code")}
          </Label>
          <Input
            id="password-nonce"
            value={nonce}
            autoComplete="one-time-code"
            onChange={(e) => setNonce(e.target.value)}
          />
        </details>
        <Button type="submit">
          {pending
            ? t("Memproses…", "Working…")
            : t("Tukar kata laluan", "Change password")}
        </Button>
      </fieldset>
      <Feedback error={error} saved={saved} />
    </form>
  );
}

function SessionActions() {
  const { t } = usePreferences();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function signOut(scope: "others" | "global") {
    if (
      !window.confirm(
        scope === "global"
          ? t(
              "Log keluar daripada semua peranti termasuk browser ini?",
              "Sign out of all devices, including this browser?",
            )
          : t(
              "Tamatkan sesi login pada semua peranti lain?",
              "End sign-in sessions on all other devices?",
            ),
      )
    )
      return;
    setPending(true);
    setError("");
    setSaved(false);
    try {
      const { error } = await supabase.auth.signOut({ scope });
      if (error) throw error;
      if (scope === "global") {
        client.clear();
        window.location.assign("/auth");
      } else setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <div className="lc-settings-actions">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => signOut("others")}
        >
          {t("Log keluar peranti lain", "Sign out other devices")}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => signOut("global")}
        >
          {t("Log keluar semua peranti", "Sign out all devices")}
        </Button>
      </div>
      <Feedback error={error} saved={saved} />
    </div>
  );
}

export function Feedback({
  error,
  saved,
}: {
  error?: string;
  saved?: boolean;
}) {
  const { t } = usePreferences();
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="lc-settings-help">
          {t("Perubahan disimpan.", "Changes saved.")}
        </p>
      )}
    </>
  );
}
export function LoadError({ retry }: { retry: () => unknown }) {
  const { t } = usePreferences();
  return (
    <div>
      <p role="alert">
        {t("Maklumat tidak dapat dimuatkan.", "Could not load details.")}
      </p>
      <Button variant="outline" onClick={retry}>
        {t("Cuba semula", "Retry")}
      </Button>
    </div>
  );
}
