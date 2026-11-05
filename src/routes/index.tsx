import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { BrandLogo } from "@/components/lokalchat/BrandLogo";
import { LandingDemo } from "@/components/lokalchat/LandingDemo";
import { ThemeToggle } from "@/components/lokalchat/ThemeToggle";
import "@/styles/landing.css";

const DESCRIPTION = "WhatsApp support for Malaysian businesses. Answer from your own FAQs in Bahasa Melayu, English and Manglish, and take over whenever you need to.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LokalChat | WhatsApp support with a local touch" },
      {
        name: "description",
        content:
          DESCRIPTION,
      },
      { property: "og:title", content: "LokalChat | WhatsApp support with a local touch" },
      {
        property: "og:description",
        content:
          DESCRIPTION,
      },
      { property: "og:locale", content: "en_MY" },
      { property: "og:image", content: "/images/lokalchat-ribbon-hero.webp" },
      { property: "og:image:alt", content: "Sculptural teal ribbons on a dark green background" },
    ],
    links: [
      { rel: "canonical", href: "/" },
      { rel: "preload", href: "/images/lokalchat-ribbon-hero.webp", as: "image", type: "image/webp" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main className="lc-landing" lang="en" id="top">
      <svg className="lc-logo-filter" aria-hidden="true" focusable="false" width="0" height="0">
        <defs>
          <filter id="lc-logo-transparent" colorInterpolationFilters="sRGB">
            {/* Remove the artwork's white canvas before adapting its colors for dark surfaces. */}
            <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 -1 -1 0 3" />
          </filter>
        </defs>
      </svg>
      <a className="lc-skip" href="#demo">Skip to the demo</a>
      <header className="lc-header lc-container">
        <Link to="/" aria-label="LokalChat home" className="lc-brand"><BrandLogo width={174} /></Link>
        <nav aria-label="Main navigation" className="lc-nav">
          <a href="#demo">The product</a>
          <a href="#how-it-works">How it works</a>
          <a href="#download" className="lc-download-link">Download</a>
        </nav>
        <div className="lc-header-actions">
          <ThemeToggle lang="en" />
          <Link to="/auth" className="lc-login">Log in</Link>
          <Link to="/auth" className="lc-button lc-button-small">Create account</Link>
        </div>
      </header>

      <section className="lc-hero" aria-labelledby="hero-title">
        <div className="lc-hero-art" aria-hidden="true">
          <img src="/images/lokalchat-ribbon-hero.webp" alt="" width={1672} height={941} fetchPriority="high" decoding="async" />
        </div>
        <div className="lc-hero-copy lc-container">
          <h1 id="hero-title">WhatsApp support.<br /><span>With a local touch.</span></h1>
          <p>
            AI that speaks your customers’ language, learns your business,
            and knows when to hand it back to you.
          </p>
          <div className="lc-hero-actions">
            <a href="#demo" className="lc-button">Try a conversation <ArrowDown size={17} aria-hidden="true" /></a>
            <Link to="/dashboard" className="lc-text-link">Open dashboard</Link>
          </div>
        </div>
        <div className="lc-hero-foot lc-container">
          <p>Made for Malaysian businesses.</p>
          <ul aria-label="Product capabilities">
            <li>BM, English &amp; Manglish</li>
            <li>Your knowledge. Your answers.</li>
            <li>A human when it matters</li>
          </ul>
        </div>
      </section>

      <section id="demo" className="lc-demo-section lc-container" aria-labelledby="demo-title">
        <div className="lc-section-heading">
          <h2 id="demo-title">Built for local<br />conversations.</h2>
          <p>“Bila pos, boss?” is a perfectly good question. Give it a useful answer, drawn from what your shop actually knows.</p>
        </div>
        <LandingDemo />
      </section>

      <section id="how-it-works" className="lc-how lc-container" aria-labelledby="how-title">
        <div className="lc-how-heading">
          <h2 id="how-title">Your shop.<br />Your answers.</h2>
          <p>Set the knowledge. Connect the conversation. Stay in control.</p>
        </div>
        <ol className="lc-workflow">
          <li><h3>Bring your knowledge</h3><p>Add your FAQs and documents, so answers start with your business information.</p></li>
          <li><h3>Connect WhatsApp</h3><p>Set up WhatsApp Business and your AI provider. Connect an inventory API if you want stock checks.</p></li>
          <li><h3>Keep the final say</h3><p>Follow the conversation in your inbox. Take over when a customer needs you.</p></li>
        </ol>
      </section>

      <section id="download" className="lc-download lc-container" aria-labelledby="download-title">
        <div>
          <h2 id="download-title">Download</h2>
          <p>Install LokalChat with npm.</p>
        </div>
        <div className="lc-npm-placeholder">
          <p>npm installer</p>
          <pre aria-label="npm installer placeholder"><code># Installer coming soon</code></pre>
          <p>The installation command will be available here.</p>
        </div>
      </section>

      <footer className="lc-footer">
        <div className="lc-container lc-footer-inner">
          <div>
            <h2>Make room for<br />better conversations.</h2>
            <Link to="/auth" className="lc-button">Create account <ArrowUpRight size={17} aria-hidden="true" /></Link>
          </div>
          <div className="lc-footer-note">
            <a href="#top" className="lc-brand" aria-label="Back to top"><BrandLogo width={174} /></a>
            <p>Local language. Real business.</p>
            <p>Built for Malaysia.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}

