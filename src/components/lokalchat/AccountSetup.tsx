import { Link } from "@tanstack/react-router";
import { ConsoleShell } from "./ConsoleShell";

export function AccountSetup() {
  return <ConsoleShell>
    <section className="max-w-2xl space-y-5 p-6" aria-labelledby="account-ready-title">
      <h1 id="account-ready-title" className="text-2xl font-semibold">Akaun LokalChat sedia</h1>
      <p>Anda sudah log masuk. Akaun dan sesi LokalChat berfungsi tanpa Supabase.</p>
      <p>Sambungan data pemasangan ini belum tersedia. Selepas backend disediakan, cuba buka dashboard semula. Tetapan akaun dan provider AI masih boleh diurus di Settings.</p>
      <Link to="/dashboard/settings" hash="configuration" className="inline-flex rounded-md bg-primary px-4 py-3 text-primary-foreground">Buka konfigurasi</Link>
    </section>
  </ConsoleShell>;
}
