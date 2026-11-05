import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasPublicConfig } from "@/lib/public-config";
import { BrandLogo } from "@/components/lokalchat/BrandLogo";
import { ThemeToggle } from "@/components/lokalchat/ThemeToggle";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Log Masuk — LokalChat" },
      {
        name: "description",
        content: "Log masuk atau daftar akaun peniaga untuk urus AI WhatsApp agent kedai anda.",
      },
      { property: "og:title", content: "Log Masuk — LokalChat" },
      {
        property: "og:description",
        content: "Akses dashboard LokalChat untuk urus chat WhatsApp dan FAQ kedai anda.",
      },
    ],
    links: [{ rel: "canonical", href: "/auth" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  const configured = hasPublicConfig(import.meta.env["VITE_SUPABASE_URL"], import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate, configured]);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!configured || loading) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal log masuk.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!configured || loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: { business_name: businessName || "Kedai Saya" },
        },
      });
      if (error) throw error;
      if (data.session) {
        await navigate({ to: "/dashboard" });
      } else {
        toast.success("Akaun dicipta. Semak emel untuk mengesahkan pendaftaran sebelum log masuk.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mendaftar akaun.");
    } finally {
      setLoading(false);
    }
  };


  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Kembali ke laman utama
          </Link>
          <ThemeToggle />
        </div>
        <div className="surface-panel p-7">
          <div className="mb-4 flex justify-center">
            <BrandLogo width={176} />
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Log masuk untuk urus perbualan WhatsApp kedai anda.
          </p>

          {!configured && <p role="alert" className="mt-4 text-sm text-destructive">Sambungan belum dikonfigurasi. Tetapkan VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY dalam .env dahulu.</p>}
          <Tabs defaultValue="signin" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Log Masuk</TabsTrigger>
              <TabsTrigger value="signup">Daftar</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Emel</Label>
                  <Input disabled={!ready || loading}
                    id="signin-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Kata laluan</Label>
                  <Input disabled={!ready || loading}
                    id="signin-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading || !configured || !ready}>
                  Log Masuk
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-business">Nama kedai</Label>
                  <Input disabled={!ready || loading}
                    id="signup-business"
                    value={businessName}
                    placeholder="Kedai Runcit Pak Man"
                    onChange={(e) => setBusinessName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Emel</Label>
                  <Input disabled={!ready || loading}
                    id="signup-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Kata laluan</Label>
                  <Input disabled={!ready || loading}
                    id="signup-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading || !configured || !ready}>
                  Daftar Akaun
                </Button>
              </form>
            </TabsContent>
          </Tabs>


        </div>
      </div>
    </main>
  );
}

