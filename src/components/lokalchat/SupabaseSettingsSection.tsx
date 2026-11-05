import { usePreferences } from "@/components/lokalchat/usePreferences";
import { useSettingsDirty } from "./SettingsDirtyContext";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSupabaseSettings,
  saveSupabaseSettings,
  useApi,
} from "@/services/api";
import {
  validateSupabaseSettings,
  type SupabaseSettingsInput,
} from "@/lib/supabase-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SupabaseSettingsSection() {
  const { translate: tr } = usePreferences();
  const client = useQueryClient();
  const fetchSettings = useApi(getSupabaseSettings);
  const saveSettings = useApi(saveSupabaseSettings);
  const query = useQuery({
    queryKey: ["supabase-settings"],
    queryFn: fetchSettings,
    retry: false,
  });
  const settings = query.data;
  const [projectUrl, setProjectUrl] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showPublicKey, setShowPublicKey] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const baseline = useRef<string | null>(null);
  const dirty = Boolean(
    baseline.current !== null &&
    (projectUrl !== baseline.current || publicKey || secretKey),
  );
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useSettingsDirty(dirty);
  useEffect(() => {
    if (settings && !dirtyRef.current) {
      baseline.current = settings.projectUrl;
      setProjectUrl(settings.projectUrl);
    }
  }, [settings]);

  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (input: SupabaseSettingsInput) => saveSettings({ data: input }),
    onSuccess: (result) => {
      setPublicKey("");
      setSecretKey("");
      setShowPublicKey(false);
      setShowSecretKey(false);
      setError("");
      setSaved(true);
      baseline.current = result.projectUrl;
      client.setQueryData(["supabase-settings"], result);
    },
    onError: () =>
      setError(
        tr(
          "Konfigurasi gagal disimpan. Semak input, akses tulis fail env dan sambungan server, kemudian cuba semula.",
        ),
      ),
    // Submitted credentials must not remain in React Query's mutation cache.
    onSettled: (): void => {
      mutation.reset();
    },
  });
  function changed() {
    setSaved(false);
    setError("");
  }
  let sameProject = false;
  try {
    sameProject = new URL(projectUrl).origin === settings?.projectUrl;
  } catch {
    /* Incomplete URL while typing. */
  }
  const retainPublicKey = sameProject && settings?.hasPublicKey;
  const retainSecretKey = sameProject && settings?.hasSecretKey;

  return (
    <section
      id="supabase"
      data-ui
      aria-labelledby="supabase-title"
      className="mt-10 scroll-mt-6 border-t border-border pt-8"
    >
      <h2 id="supabase-title" className="text-lg font-semibold">
        Supabase
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {tr(
          "Simpan profil sambungan Supabase anda sendiri. URL dan API key ini hanya boleh diurus oleh akaun anda.",
        )}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {tr("Profil ini tidak menukar sambungan aplikasi. Login, database dan fail masih menggunakan projek pemasangan dengan pengasingan data melalui RLS.")}
      </p>
      <a
        className="mt-3 inline-block text-sm underline underline-offset-4 hover:text-muted-foreground"
        href="https://supabase.com/docs/guides/getting-started/api-keys"
        target="_blank"
        rel="noopener noreferrer"
      >
        {tr("Cara mendapatkan URL projek dan API key Supabase")}
      </a>
      {query.isPending && (
        <p role="status" className="mt-4 text-sm">
          {tr("Memuatkan konfigurasi Supabase…")}
        </p>
      )}
      {query.isError && (
        <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {tr("Konfigurasi Supabase tidak dapat dimuatkan.")}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => query.refetch()}
          >
            {tr("Cuba semula")}
          </Button>
        </div>
      )}
      {settings && (
        <form
          aria-labelledby="supabase-title"
          aria-busy={mutation.isPending}
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (mutation.isPending) return;
            changed();
            try {
              const input = validateSupabaseSettings({
                projectUrl,
                publicKey,
                secretKey,
              });
              if (
                (!input.publicKey && !retainPublicKey) ||
                (!input.secretKey && !retainSecretKey)
              )
                throw new Error(
                  tr("Masukkan kedua-dua API key untuk projek ini"),
                );
              mutation.mutate(input);
            } catch (cause) {
              setError((cause as Error).message);
            }
          }}
        >
          <p
            id="supabase-change-help"
            className="text-sm text-muted-foreground"
          >
            {tr(
              "Projek sendiri perlu menyediakan schema, storage dan akaun yang diperlukan LokalChat. Data tidak dipindahkan apabila profil disimpan.",
            )}
          </p>
          <fieldset disabled={mutation.isPending} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supabase-url">{tr("URL projek")}</Label>
              <Input
                id="supabase-url"
                type="url"
                value={projectUrl}
                onChange={(event) => {
                  setProjectUrl(event.target.value);
                  setPublicKey("");
                  setSecretKey("");
                  setShowPublicKey(false);
                  setShowSecretKey(false);
                  changed();
                }}
                placeholder="https://projek-anda.supabase.co"
                maxLength={2048}
                required
                aria-describedby="supabase-url-help supabase-change-help"
              />
              <p
                id="supabase-url-help"
                className="text-xs text-muted-foreground"
              >
                {tr(
                  "URL projek HTTPS atau HTTP localhost. Tanpa /rest/v1 atau /auth/v1.",
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supabase-public-key">
                Publishable / anon key
                {retainPublicKey ? tr(" baharu (pilihan)") : ""}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="supabase-public-key"
                  type={showPublicKey ? "text" : "password"}
                  value={publicKey}
                  onChange={(event) => {
                    setPublicKey(event.target.value);
                    changed();
                  }}
                  placeholder={
                    retainPublicKey
                      ? tr("Key sudah disimpan")
                      : "sb_publishable_… atau anon key"
                  }
                  autoCapitalize="none"
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={4096}
                  required={!retainPublicKey}
                  aria-describedby="supabase-public-help"
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-controls="supabase-public-key"
                  aria-pressed={showPublicKey}
                  aria-label={
                    showPublicKey
                      ? tr("Sembunyikan publishable key")
                      : tr("Paparkan publishable key")
                  }
                  onClick={() => setShowPublicKey(!showPublicKey)}
                >
                  {showPublicKey ? tr("Sembunyi") : tr("Papar")}
                </Button>
              </div>
              <p
                id="supabase-public-help"
                className="text-xs text-muted-foreground"
              >
                {retainPublicKey
                  ? tr(
                      "Key sudah disimpan. Biarkan kosong untuk mengekalkannya. ",
                    )
                  : ""}
                {tr(
                  "Gunakan sb_publishable_ atau legacy anon. Key ini boleh digunakan oleh browser bagi projek anda.",
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supabase-secret-key">
                Secret / service_role key
                {retainSecretKey ? tr(" baharu (pilihan)") : ""}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="supabase-secret-key"
                  type={showSecretKey ? "text" : "password"}
                  value={secretKey}
                  onChange={(event) => {
                    setSecretKey(event.target.value);
                    changed();
                  }}
                  placeholder={
                    retainSecretKey
                      ? tr("Key sudah disimpan")
                      : "sb_secret_… atau service_role key"
                  }
                  autoCapitalize="none"
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={4096}
                  required={!retainSecretKey}
                  aria-describedby="supabase-secret-help"
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-controls="supabase-secret-key"
                  aria-pressed={showSecretKey}
                  aria-label={
                    showSecretKey
                      ? tr("Sembunyikan secret key")
                      : tr("Paparkan secret key")
                  }
                  onClick={() => setShowSecretKey(!showSecretKey)}
                >
                  {showSecretKey ? tr("Sembunyi") : tr("Papar")}
                </Button>
              </div>
              <p
                id="supabase-secret-help"
                className="text-xs text-muted-foreground"
              >
                {retainSecretKey
                  ? tr(
                      "Key sudah disimpan. Biarkan kosong untuk mengekalkannya. ",
                    )
                  : ""}
                {tr(
                  "Gunakan sb_secret_ atau legacy service_role. Disimpan untuk kegunaan server sahaja.",
                )}
              </p>
            </div>
            <Button type="submit">
              {mutation.isPending
                ? tr("Menyimpan…")
                : tr("Simpan konfigurasi Supabase")}
            </Button>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm">
              {tr(
                "Profil Supabase disimpan untuk akaun anda sahaja. Sambungan aplikasi tidak berubah.",
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {tr(
              "Simpanan mengesahkan format sahaja. Key, sambungan dan schema projek belum diuji.",
            )}
          </p>
        </form>
      )}
    </section>
  );
}
