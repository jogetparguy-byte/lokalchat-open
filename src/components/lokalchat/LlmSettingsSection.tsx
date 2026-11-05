import { usePreferences } from "@/components/lokalchat/usePreferences";
import { useSettingsDirty } from "./SettingsDirtyContext";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getLlmSettings, saveLlmSettings, useApi } from "@/services/api";
import {
  LLM_PROVIDERS,
  validateLlmSettings,
  type LlmProvider,
  type LlmSettingsInput,
} from "@/lib/llm-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LlmSettingsSection() {
  const { translate: tr } = usePreferences();
  const client = useQueryClient();
  const fetchSettings = useApi(getLlmSettings);
  const saveSettings = useApi(saveLlmSettings);
  const query = useQuery({
    queryKey: ["llm-settings"],
    queryFn: fetchSettings,
    retry: false,
  });
  const settings = query.data;
  const [provider, setProvider] = useState<LlmProvider>("gemini");
  const [baseUrl, setBaseUrl] = useState<string>(LLM_PROVIDERS.gemini.baseUrl);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const baseline = useRef<{
    provider: string;
    baseUrl: string;
    model: string;
  } | null>(null);
  const dirty = Boolean(
    baseline.current &&
    (provider !== baseline.current.provider ||
      baseUrl !== baseline.current.baseUrl ||
      model !== baseline.current.model ||
      apiKey),
  );
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useSettingsDirty(dirty);
  useEffect(() => {
    if (settings && !dirtyRef.current) {
      baseline.current = {
        provider: settings.provider,
        baseUrl: settings.baseUrl || LLM_PROVIDERS[settings.provider].baseUrl,
        model: settings.model,
      };
      setProvider(settings.provider);
      setBaseUrl(settings.baseUrl || LLM_PROVIDERS[settings.provider].baseUrl);
      setModel(settings.model);
    }
  }, [settings]);

  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (input: LlmSettingsInput) => saveSettings({ data: input }),
    onSuccess: (result) => {
      setApiKey("");
      setShowApiKey(false);
      setError("");
      setSaved(true);
      baseline.current = {
        provider: result.provider,
        baseUrl: result.baseUrl || LLM_PROVIDERS[result.provider].baseUrl,
        model: result.model,
      };
      client.setQueryData(["llm-settings"], result);
    },
    // Never retain an API key in the React Query mutation cache after completion.
    onSettled: (): void => {
      mutation.reset();
    },
    onError: () =>
      setError(
        tr(
          "Konfigurasi gagal disimpan. Semak input, akses tulis fail env dan sambungan server, kemudian cuba semula.",
        ),
      ),
  });

  const retainKey = Boolean(
    settings?.hasApiKey &&
    settings.provider === provider &&
    settings.baseUrl.replace(/\/+$/, "") === baseUrl.replace(/\/+$/, ""),
  );
  function changed() {
    setSaved(false);
    setError("");
  }

  return (
    <section
      id="llm"
      data-ui
      aria-labelledby="llm-title"
      className="mt-10 scroll-mt-6 border-t border-border pt-8"
    >
      <h2 id="llm-title" className="text-lg font-semibold">
        {tr("Provider AI")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {tr(
          "Pilih LLM untuk balasan AI akaun anda. Setiap pengguna menggunakan provider dan API key sendiri. ",
        )}
      </p>
      {query.isPending && (
        <p role="status" className="mt-4 text-sm">
          {tr("Memuatkan konfigurasi AI…")}
        </p>
      )}
      {query.isError && (
        <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {tr("Konfigurasi AI tidak dapat dimuatkan.")}
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
      {query.data && (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!settings || mutation.isPending) return;
            changed();
            try {
              const input = validateLlmSettings({
                provider,
                apiKey,
                baseUrl,
                model,
              });
              if (!input.apiKey && !retainKey)
                throw new Error(tr("Masukkan API key untuk provider ini"));
              mutation.mutate(input);
            } catch (cause) {
              setError((cause as Error).message);
            }
          }}
        >
          <fieldset
            disabled={!settings || mutation.isPending}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="llm-provider">{tr("Provider LLM")}</Label>
              <select
                id="llm-provider"
                value={provider}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => {
                  const next = event.target.value as LlmProvider;
                  setProvider(next);
                  setBaseUrl(LLM_PROVIDERS[next].baseUrl);
                  setModel("");
                  setApiKey("");
                  setShowApiKey(false);
                  changed();
                }}
              >
                {Object.entries(LLM_PROVIDERS).map(([id, item]) => (
                  <option key={id} value={id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="llm-model">{tr("ID model")}</Label>
              <Input
                id="llm-model"
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  changed();
                }}
                autoComplete="off"
                maxLength={200}
                required
                aria-describedby="llm-model-help"
              />
              <p id="llm-model-help" className="text-xs text-muted-foreground">
                {tr(
                  "Gunakan ID model daripada provider anda yang menyokong chat completions dan tool calling.",
                )}
              </p>
            </div>
            {provider === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="llm-base-url">Base URL</Label>
                <Input
                  id="llm-base-url"
                  type="url"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    setApiKey("");
                    changed();
                  }}
                  placeholder="https://api.provider.com/v1"
                  maxLength={2048}
                  required
                  aria-describedby="llm-url-help"
                />
                <p id="llm-url-help" className="text-xs text-muted-foreground">
                  {tr(
                    "Endpoint HTTPS awam yang serasi dengan OpenAI. Jangan tambah /chat/completions.",
                  )}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="llm-key">
                API key{retainKey ? tr(" baharu (pilihan)") : ""}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="llm-key"
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    changed();
                  }}
                  placeholder={
                    retainKey
                      ? tr("Key sudah disimpan")
                      : tr("Masukkan API key provider anda")
                  }
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={4096}
                  required={!retainKey}
                  aria-describedby="llm-key-help"
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-controls="llm-key"
                  aria-pressed={showApiKey}
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? tr("Sembunyi") : tr("Papar")}
                </Button>
              </div>
              <p id="llm-key-help" className="text-xs text-muted-foreground">
                {retainKey
                  ? tr(
                      "Key sudah disimpan. Biarkan kosong untuk mengekalkannya.",
                    )
                  : tr(
                      "Key dihantar ke server dan disimpan dalam fail env peribadi akaun anda.",
                    )}
              </p>
            </div>
            <Button type="submit">
              {mutation.isPending
                ? tr("Menyimpan…")
                : tr("Simpan konfigurasi AI")}
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
                "Konfigurasi AI disimpan dan digunakan untuk balasan seterusnya.",
              )}
            </p>
          )}
          {!saved && settings?.active && (
            <p className="text-xs text-muted-foreground">
              {tr("Konfigurasi daripada Settings sedang digunakan.")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {tr(
              "Simpanan ini tidak menguji kesahihan key, kredit atau akses model pada provider.",
            )}
          </p>
        </form>
      )}
    </section>
  );
}
