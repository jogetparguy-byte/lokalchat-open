import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/services/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getProfile,
  updateProfile,
  getWhatsappConnection,
  saveWhatsappConnection,
} from "@/services/api";
import { BrandLogo } from "@/components/lokalchat/BrandLogo";

export const Route = createFileRoute("/_authenticated/dashboard_/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Tetapan Perniagaan — LokalChat" },
      {
        name: "description",
        content: "Kemas kini nama kedai dan URL API inventori untuk semakan stok automatik.",
      },
      { property: "og:title", content: "Tetapan Perniagaan — LokalChat" },
      {
        property: "og:description",
        content: "Kemas kini nama kedai dan URL API inventori untuk semakan stok automatik.",
      },
    ],
    links: [{ rel: "canonical", href: "/dashboard/settings" }],
  }),
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const fetchProfile = useApi(getProfile);
  const saveProfile = useApi(updateProfile);

  const [businessName, setBusinessName] = useState("");
  const [inventoryApiUrl, setInventoryApiUrl] = useState("");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState("");
  const [errors, setErrors] = useState<{ name?: string; url?: string }>({});

  const profileQuery = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });

  useEffect(() => {
    if (profileQuery.data) {
      setBusinessName(profileQuery.data.business_name ?? "");
      setInventoryApiUrl(profileQuery.data.inventory_api_url ?? "");
      setOwnerWhatsapp(profileQuery.data.owner_whatsapp ?? "");
    }
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: { businessName: string; inventoryApiUrl: string; ownerWhatsapp: string }) =>
      saveProfile({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Tetapan berjaya disimpan");
    },
    onError: (error: Error) => toast.error(error.message || "Gagal menyimpan tetapan"),
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const name = businessName.trim();
    const url = inventoryApiUrl.trim();
    const nextErrors: { name?: string; url?: string } = {};

    if (!name) nextErrors.name = "Nama perniagaan diperlukan";
    else if (name.length > 100) nextErrors.name = "Nama terlalu panjang (maks 100 aksara)";

    if (url) {
      try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol)) {
          nextErrors.url = "URL mesti bermula dengan http:// atau https://";
        }
      } catch {
        nextErrors.url = "Format URL tidak sah";
      }
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    saveMutation.mutate({ businessName: name, inventoryApiUrl: url, ownerWhatsapp: ownerWhatsapp.trim() });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <BrandLogo width={176} />
          <p className="text-xs text-muted-foreground">Tetapan Perniagaan</p>
        </div>
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Kembali ke dashboard
        </Link>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <h1 className="text-xl font-semibold">Tetapan Perniagaan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Maklumat ini digunakan oleh AI agent semasa membalas pelanggan anda.
        </p>

        {profileQuery.isError && <p role="alert" className="mt-4 text-sm text-destructive">{profileQuery.error.message}</p>}
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="business-name">Nama Perniagaan</Label>
            <Input
              id="business-name"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              maxLength={100}
              required
              disabled={profileQuery.isPending || profileQuery.isError}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="inventory-url">URL API Inventori (pilihan)</Label>
            <Input
              id="inventory-url"
              value={inventoryApiUrl}
              onChange={(event) => setInventoryApiUrl(event.target.value)}
              placeholder="https://api.kedaisaya.com/stock"
              disabled={profileQuery.isPending || profileQuery.isError}
            />
            <p className="text-xs text-muted-foreground">
              Digunakan untuk semakan ketersediaan stok secara langsung semasa pelanggan bertanya.
            </p>
            {errors.url && <p className="text-sm text-destructive">{errors.url}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="owner-whatsapp">No. WhatsApp Peribadi Pemilik (pilihan)</Label>
            <Input
              id="owner-whatsapp"
              value={ownerWhatsapp}
              onChange={(event) => setOwnerWhatsapp(event.target.value)}
              placeholder="60123456789"
              inputMode="tel"
              disabled={profileQuery.isPending || profileQuery.isError}
            />
            <p className="text-xs text-muted-foreground">
              Laporan mingguan LokalChat akan dihantar ke nombor ini setiap Isnin pagi.
            </p>
          </div>

          <Button type="submit" disabled={saveMutation.isPending || profileQuery.isPending || profileQuery.isError}>
            {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </form>

        <WhatsappConnectionSection />
      </main>
    </div>
  );
}

function WhatsappConnectionSection() {
  const queryClient = useQueryClient();
  const fetchConnection = useApi(getWhatsappConnection);
  const saveConnection = useApi(saveWhatsappConnection);

  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/public/whatsapp`);
  }, []);

  const connectionQuery = useQuery({
    queryKey: ["whatsapp-connection"],
    queryFn: fetchConnection,
  });
  const connection = connectionQuery.data;
  const status = connection?.connection_status ?? null;
  const isConnected = status === "connected";
  const isInvalid = status === "invalid";
  const formVisible = showForm || !connection || (!isConnected && !isInvalid);

  const connectMutation = useMutation({
    mutationFn: () =>
      saveConnection({
        data: {
          phoneNumberId: phoneNumberId.trim(),
          accessToken: accessToken.trim(),
          appSecret: appSecret.trim(),
          verifyToken: verifyToken.trim(),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-connection"] });
      setAccessToken("");
      setAppSecret("");
      setVerifyToken("");
      setShowForm(false);
      toast.success("Sambungan WhatsApp berjaya disahkan");
    },
    onError: (error: Error) => toast.error(error.message || "Gagal menyambung WhatsApp"),
  });

  useEffect(() => {
    if (connection?.phone_number_id) setPhoneNumberId(connection.phone_number_id);
  }, [connection?.phone_number_id]);

  return (
    <section id="whatsapp" className="mt-10 scroll-mt-6 border-t border-border pt-8">
      <h2 className="text-lg font-semibold">Sambungan WhatsApp</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sahkan nombor WhatsApp Business anda. Kredensial dihantar ke server dan disimpan secara disulitkan.
      </p>

      {connectionQuery.isError && <p role="alert" className="mt-4 text-sm text-destructive">{connectionQuery.error.message}</p>}
      {connectionQuery.isPending && <p className="mt-4 text-sm">Memuatkan sambungan…</p>}
      {isConnected && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <span className="text-sm font-medium">
            {connection?.display_phone_number ?? connection?.phone_number_id}
          </span>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-600">
            Disambung
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setShowForm((v) => !v)}
          >
            Kemas kini kredensial
          </Button>
        </div>
      )}

      {isInvalid && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm font-medium text-destructive">
            Sambungan WhatsApp terputus — sila sambung semula
          </p>
          {connection?.last_error_message && (
            <p className="mt-1 text-xs text-destructive/80">{connection.last_error_message}</p>
          )}
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => setShowForm(true)}
          >
            Sambung Semula
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowGuide((v) => !v)}
        className="mt-4 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        {showGuide ? "Sembunyikan panduan" : "Panduan langkah demi langkah"}
      </button>

      {showGuide && (
        <ol className="mt-3 space-y-2 rounded-md border border-border p-4 text-xs text-muted-foreground">
          <li>
            1. Buka <strong>developers.facebook.com</strong> → App anda → <strong>WhatsApp
            → API Setup</strong>. Salin <strong>Phone Number ID</strong> di situ.
          </li>
          <li>
            2. Di halaman yang sama (atau <strong>Business Settings → System Users</strong>),
            jana <strong>Access Token</strong> kekal dengan kebenaran{" "}
            <code>whatsapp_business_messaging</code>.
          </li>
          <li>
            3. <strong>Settings → Basic</strong> → klik "Show" pada{" "}
            <strong>App Secret</strong> dan salin nilainya.
          </li>
          <li>
            4. <strong>Verify Token</strong> ialah rentetan rahsia pilihan anda sendiri
            (contoh: <code>lokalchat-kedai-saya-2026</code>).
          </li>
          <li>
            5. <strong>WhatsApp → Configuration → Webhook → Edit</strong>. Masukkan
            Callback URL: <code className="break-all">{webhookUrl}</code> dan Verify Token
            yang sama seperti di atas, kemudian klik <strong>Verify and save</strong>.
          </li>
          <li>
            6. Klik <strong>Manage</strong> pada Webhook fields dan langgan{" "}
            <code>messages</code>.
          </li>
        </ol>
      )}

      {formVisible && !connectionQuery.isPending && !connectionQuery.isError && (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            connectMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="wa-phone-id">Phone Number ID</Label>
            <Input
              id="wa-phone-id"
              type="text"
              inputMode="numeric"
              value={phoneNumberId}
              onChange={(event) => setPhoneNumberId(event.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wa-token">Access Token</Label>
            <Input
              id="wa-token"
              type="password"
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wa-secret">App Secret</Label>
            <Input
              id="wa-secret"
              type="password"
              value={appSecret}
              onChange={(event) => setAppSecret(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wa-verify">Verify Token</Label>
            <Input
              id="wa-verify"
              type="password"
              value={verifyToken}
              onChange={(event) => setVerifyToken(event.target.value)}
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">
              Rentetan pilihan anda sendiri — tampal nilai yang sama dalam konfigurasi
              webhook Meta App anda.
            </p>
          </div>

          <Button type="submit" disabled={connectMutation.isPending}>
            {connectMutation.isPending ? "Menguji sambungan..." : "Uji & Simpan Sambungan"}
          </Button>
        </form>
      )}
    </section>
  );
}

