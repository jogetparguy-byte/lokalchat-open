import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, Boxes, BrainCircuit, HandHelping } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/lokalchat/BrandLogo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LokalChat — AI WhatsApp Agent untuk PKS Malaysia" },
      {
        name: "description",
        content:
          "Sambung WhatsApp kedai anda kepada AI agent yang faham Bahasa Melayu pasar & Manglish, jawab FAQ, semak stok dan serah kepada anda bila perlu.",
      },
      { property: "og:title", content: "LokalChat — AI WhatsApp Agent untuk PKS Malaysia" },
      {
        property: "og:description",
        content:
          "AI customer service WhatsApp untuk kedai PKS Malaysia: RAG FAQ, semak stok live, dan human handoff.",
      },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: BrainCircuit,
    title: "Faham Manglish",
    body: "\"Ada stock tak?\", \"pm harga boss\", \"bila pos?\" — semua difahami dan dijawab mesra.",
  },
  {
    icon: MessageCircle,
    title: "RAG FAQ",
    body: "Jawapan diambil dari knowledge base kedai anda melalui carian vektor pgvector.",
  },
  {
    icon: Boxes,
    title: "Semak stok live",
    body: "Bot panggil API inventori anda untuk beri jumlah stok terkini kepada pelanggan.",
  },
  {
    icon: HandHelping,
    title: "Human handoff",
    body: "Bila bot tak pasti, ia matikan diri dan alert anda di dashboard serta-merta.",
  },
];

function Landing() {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="inline-flex items-center">
            <BrandLogo width={176} />
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth">Log Masuk</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="hero-gradient px-6 py-20 text-primary-foreground">
        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider">
            AI Customer Service · WhatsApp
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-tight sm:text-6xl">
            LokalChat
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base opacity-90 sm:text-lg">
            Bot WhatsApp yang jawab pelanggan anda 24/7 dalam bahasa mereka — dan tahu
            bila masanya untuk panggil boss.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="secondary">
              <Link to="/dashboard">Buka Dashboard</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link to="/auth">Log Masuk / Daftar</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">
          Semua yang kedai anda perlukan
        </h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="surface-panel p-6">
              <feature.icon className="size-6 text-primary" aria-hidden />
              <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8 text-center text-sm text-muted-foreground">
        LokalChat · Dibina untuk PKS Malaysia
      </footer>
    </main>
  );
}

