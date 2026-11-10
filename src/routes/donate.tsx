import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Heart, ShieldCheck } from "lucide-react";
import { usePreferences } from "@/components/lokalchat/usePreferences";
import { ThemeToggle } from "@/components/lokalchat/ThemeToggle";
import "@/styles/donate.css";

export const Route = createFileRoute("/donate")({
  head: () => ({
    meta: [{ title: "Support LokalChat" }],
    links: [{ rel: "canonical", href: "/donate" }],
  }),
  component: DonatePage,
});

export function DonatePage() {
  const { t, preferences } = usePreferences();
  const [amount, setAmount] = useState("10");
  const [custom, setCustom] = useState(false);
  const [method, setMethod] = useState("toyyibpay");
  const validAmount =
    /^\d+(\.\d{1,2})?$/.test(amount) &&
    Number(amount) >= 1 &&
    Number(amount) <= 10000;
  const formattedAmount = validAmount ? `RM ${Number(amount).toFixed(2)}` : "—";

  return (
    <div className="lc-donation" data-ui>
      <nav
        className="lc-donation-nav"
        aria-label={t("Navigasi sokongan", "Support navigation")}
      >
        <Link to="/" className="lc-donation-brand">
          LokalChat<span aria-hidden="true">.</span>
        </Link>
        <ThemeToggle lang={preferences.language} />
      </nav>
      <main className="lc-donation-main">
        <header className="lc-donation-intro">
          <div className="lc-donation-heart">
            <Heart size={26} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h1>Support LokalChat</h1>
          <p>
            {t(
              "Bantu kami membina pembantu WhatsApp yang lebih baik untuk perniagaan tempatan.",
              "Help us build a better WhatsApp assistant for local businesses.",
            )}
          </p>
        </header>
        <form
          className="lc-donation-card"
          onSubmit={(event) => event.preventDefault()}
          aria-labelledby="donation-title"
        >
          <div className="lc-donation-card-heading">
            <h2 id="donation-title">
              {t("Pilih sumbangan anda", "Choose your gift")}
            </h2>
            <span>{t("Sekali sahaja", "One time")}</span>
          </div>
          <p className="lc-donation-description">
            {t(
              "Setiap sumbangan menyokong pembangunan LokalChat.",
              "Every gift supports the development of LokalChat.",
            )}
          </p>
          <fieldset>
            <legend>{t("Jumlah sumbangan", "Donation amount")}</legend>
            <div className="lc-donation-amounts">
              {["5", "10", "25", "50"].map((value) => (
                <label key={value} className="lc-donation-choice">
                  <input
                    type="radio"
                    name="amount"
                    value={value}
                    checked={!custom && amount === value}
                    onChange={() => {
                      setCustom(false);
                      setAmount(value);
                    }}
                  />
                  <span>RM {value}</span>
                </label>
              ))}
            </div>
            <label className="lc-donation-custom-choice">
              <input
                type="radio"
                name="amount"
                checked={custom}
                onChange={() => {
                  setCustom(true);
                  setAmount("");
                }}
              />
              {t("Jumlah lain", "Other amount")}
            </label>
            {custom && (
              <div className="lc-donation-custom">
                <label htmlFor="donation-amount">
                  {t(
                    "Jumlah dalam Ringgit Malaysia (RM)",
                    "Amount in Malaysian Ringgit (RM)",
                  )}
                </label>
                <input
                  id="donation-amount"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="10000"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  aria-invalid={!validAmount}
                  aria-describedby="donation-amount-help"
                />
                <p id="donation-amount-help">
                  {t(
                    "Masukkan RM1 hingga RM10,000, maksimum dua tempat perpuluhan.",
                    "Enter RM1 to RM10,000, with up to two decimal places.",
                  )}
                </p>
              </div>
            )}
          </fieldset>
          <fieldset className="lc-donation-methods">
            <legend>{t("Kaedah bayaran", "Payment method")}</legend>
            {[
              {
                id: "toyyibpay",
                name: "ToyyibPay",
                detail: t("Malaysia", "Malaysia"),
              },
              {
                id: "stripe",
                name: "Stripe",
                detail: t("Antarabangsa", "International"),
              },
            ].map((provider) => (
              <label key={provider.id} className="lc-donation-method">
                <input
                  type="radio"
                  name="method"
                  value={provider.id}
                  checked={method === provider.id}
                  onChange={() => setMethod(provider.id)}
                />
                <span>
                  <strong>{provider.name}</strong>
                  <small>{provider.detail}</small>
                </span>
                <em>{t("Akan datang", "Coming soon")}</em>
              </label>
            ))}
          </fieldset>
          <div className="lc-donation-summary" aria-live="polite">
            <span>{t("Sumbangan sekali", "One-time gift")}</span>
            <strong>{formattedAmount}</strong>
          </div>
          <button
            className="lc-donation-submit"
            type="submit"
            disabled
            aria-describedby="donation-status"
          >
            {t("Bayaran belum tersedia", "Payments not available yet")}
          </button>
          <p id="donation-status" className="lc-donation-status">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              {t(
                "ToyyibPay dan Stripe belum diaktifkan. Tiada bayaran atau maklumat dihantar melalui halaman ini.",
                "ToyyibPay and Stripe are not active yet. No payment or information is sent through this page.",
              )}
            </span>
          </p>
        </form>
        <p className="lc-donation-thanks">
          {t(
            "Terima kasih kerana menyokong LokalChat.",
            "Thank you for supporting LokalChat.",
          )}
        </p>
        <Link
          to="/dashboard/settings"
          hash="about"
          className="lc-donation-back"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {t("Kembali ke tetapan", "Back to settings")}
        </Link>
      </main>
    </div>
  );
}
