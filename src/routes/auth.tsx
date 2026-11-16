import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { accountAuth } from "@/lib/account-auth";
import { referralSources, teamSizes, useCases } from "@/lib/onboarding";
import { BrandLogo } from "@/components/lokalchat/BrandLogo";
import "@/styles/auth.css";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Welcome — LokalChat" },
      { name: "description", content: "Set up your LokalChat account, one question at a time. Already have an account? Sign in here." },
      { property: "og:title", content: "Welcome — LokalChat" },
    ],
    links: [{ rel: "canonical", href: "/auth" }],
  }),
  component: AuthPage,
});

const steps = [
  { key: "name", title: "What’s your name?", hint: "Let’s start with you.", label: "Your name", autocomplete: "name", placeholder: "Alex Morgan" },
  { key: "company", title: "What’s your company called?", hint: "The business you’ll be using LokalChat for.", label: "Company name", autocomplete: "organization", placeholder: "Your company" },
  { key: "team", title: "How big is your team?", hint: "Count everyone, including yourself.", choices: teamSizes },
  { key: "use", title: "What will you use LokalChat for?", hint: "Choose your main reason for being here.", choices: useCases },
  { key: "source", title: "How did you hear about LokalChat?", hint: "We’d like to know what brought you here.", choices: referralSources },
  { key: "email", title: "What’s your email address?", hint: "You’ll use this to sign in to your account.", label: "Email address", autocomplete: "email", placeholder: "you@company.com" },
  { key: "password", title: "Create your password.", hint: "One last step, then your account is ready.", label: "Password", autocomplete: "new-password", placeholder: "At least 8 characters" },
] as const;
type Answers = Record<typeof steps[number]["key"], string>;

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Pendaftaran")) return "We couldn’t create your account. Try signing in or use a different email.";
  if (message.startsWith("Emel atau")) return "Your email or password is incorrect. Please try again.";
  if (message.startsWith("Terlalu banyak")) return "Too many attempts. Please wait a few minutes and try again.";
  if (message.startsWith("Kata laluan")) return "Your password must be between 8 and 256 characters.";
  if (message.startsWith("Masukkan")) return "Please enter a valid email address.";
  return "We couldn’t complete that request. Check your connection and try again.";
}

function AuthPage() {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<Answers>({ name: "", company: "", team: "", use: "", source: "", email: "", password: "" });
  const [step, setStep] = useState(0);
  const [transition, setTransition] = useState<"idle" | "out" | "in">("idle");
  const pendingStep = useRef<number | null>(null);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const question = steps[step] ?? steps[0];
  useEffect(() => {
    let active = true;
    accountAuth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) void navigate({ to: "/dashboard" });
      else setReady(true);
    });
    return () => { active = false; };
  }, [navigate]);
  useEffect(() => { if (ready && transition === "idle") field.current?.focus(); }, [step, mode, ready, transition]);

  const changeStep = (next: number) => {
    if (pendingStep.current !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(next);
      setError("");
      setShowPassword(false);
      return;
    }
    pendingStep.current = next;
    setTransition("out");
  };
  const finishTransition = (event: React.AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.animationName === "auth-question-out" && pendingStep.current !== null) {
      setStep(pendingStep.current);
      setError("");
      setShowPassword(false);
      setTransition("in");
    } else if (event.animationName === "auth-question-in") {
      pendingStep.current = null;
      setTransition("idle");
    }
  };

  const update = (key: keyof Answers, value: string) => {
    setAnswers(current => ({ ...current, [key]: value }));
    setError("");
  };
  const switchMode = () => {
    setMode(current => current === "signup" ? "signin" : "signup");
    setAnswers(current => ({ ...current, password: "" }));
    setShowPassword(false);
    setError("");
    setNotice("");
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || !ready || pendingStep.current !== null) return;
    if (mode === "signup" && step < steps.length - 1) {
      if (!answers[question.key].trim()) { setError("Please answer this question to continue."); return; }
      changeStep(step + 1);
      return;
    }
    setError("");
    setLoading(true);
    try {
      if (mode === "signin") {
        const result = await accountAuth.signInWithPassword({ email: answers.email.trim(), password: answers.password });
        if (result.error) throw result.error;
        await navigate({ to: "/dashboard" });
      } else {
        const result = await accountAuth.signUp({ email: answers.email.trim(), password: answers.password,
          options: { data: { business_name: answers.company.trim(), onboarding: {
            full_name: answers.name.trim(), team_size: answers.team, use_case: answers.use, referral_source: answers.source,
          } } },
        });
        if (result.error) throw result.error;
        setAnswers(current => ({ ...current, password: "" }));
        if (result.data.session) await navigate({ to: "/dashboard" });
        else { setMode("signin"); setNotice("Account created. Check your email for confirmation before signing in."); }
      }
    } catch (failure) { setError(authError(failure)); }
    finally { setLoading(false); }
  };

  const passwordInput = (id: string, signup: boolean) => (
    <div className="auth-password">
      <input ref={signup ? field : undefined} id={id} type={showPassword ? "text" : "password"}
        autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 8 : undefined} maxLength={256}
        placeholder={signup ? "At least 8 characters" : "Your password"} value={answers.password}
        onChange={event => update("password", event.target.value)} aria-describedby={signup ? "password-help auth-error" : "auth-error"} />
      <button type="button" aria-controls={id} aria-pressed={showPassword} onClick={() => setShowPassword(current => !current)}>{showPassword ? "Hide" : "Show"}</button>
    </div>
  );

  return (
    <main className="auth-page" lang="en">
      <header className="auth-header"><BrandLogo width={152} /></header>
      <div className="auth-content">
        <section className="auth-question" data-transition={transition} inert={transition !== "idle"}
          onAnimationEnd={finishTransition} aria-labelledby="auth-title" aria-busy={!ready || loading || transition !== "idle"}>
          <div className="auth-context">
            <span>{mode === "signup" ? "Your LokalChat account" : "Your LokalChat workspace"}</span>
            {mode === "signup" && <span aria-live="polite">{step + 1} of {steps.length}</span>}
          </div>
          {mode === "signup" && <div className="auth-progress" role="progressbar" aria-label="Account setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={step + 1}>
            {steps.map((item, index) => <span key={item.key} className={index <= step ? "is-complete" : ""} />)}
          </div>}
          <h1 id="auth-title">{mode === "signup" ? question.title : "Welcome back."}</h1>
          <p className="auth-hint">{mode === "signup" ? question.hint : "Sign in to your LokalChat account."}</p>
          {notice && <p role="status" className="auth-notice">{notice}</p>}
          <form onSubmit={submit}>
            <fieldset disabled={!ready || loading} className="auth-fields" key={mode === "signup" ? question.key : "signin"}>
              {mode === "signin" ? <>
                <label htmlFor="signin-email">Email address</label>
                <input ref={field} id="signin-email" type="email" autoComplete="username" required maxLength={254} value={answers.email} placeholder="you@company.com" onChange={event => update("email", event.target.value)} />
                <label htmlFor="signin-password">Password</label>
                {passwordInput("signin-password", false)}
              </> : "choices" in question ? <>
                <legend className="sr-only">{question.title}</legend>
                <div className="auth-options">{question.choices.map((choice, index) => <label key={choice} className="auth-option">
                  <input ref={index === 0 ? field : undefined} type="radio" name={question.key} value={choice} required checked={answers[question.key] === choice} onChange={() => update(question.key, choice)} />
                  <span>{choice}</span>
                </label>)}</div>
              </> : <>
                <label htmlFor={`setup-${question.key}`} className="sr-only">{question.label}</label>
                {question.key === "password" ? <>{passwordInput("setup-password", true)}<p id="password-help" className="auth-field-help">Use 8–256 characters.</p></> :
                  <input ref={field} id={`setup-${question.key}`} type={question.key === "email" ? "email" : "text"} autoComplete={question.autocomplete} required
                    maxLength={question.key === "email" ? 254 : 160} pattern={question.key === "email" ? undefined : ".*\\S.*"}
                    placeholder={question.placeholder} value={answers[question.key]} onChange={event => update(question.key, event.target.value)} aria-describedby="auth-error" />}
              </>}
              <p id="auth-error" role="alert" className="auth-error">{error}</p>
              <div className="auth-actions">
                {mode === "signup" && step > 0 && <button type="button" className="auth-back" onClick={() => changeStep(step - 1)}>Back</button>}
                <button type="submit" className="auth-submit">{!ready ? "Loading…" : loading ? (mode === "signin" ? "Signing in…" : "Creating account…") : mode === "signin" ? "Sign in" : step === steps.length - 1 ? "Create account" : "Continue"}</button>
              </div>
            </fieldset>
          </form>
          <p className="auth-switch">{mode === "signup" ? "Already have an account?" : "New to LokalChat?"} <button type="button" disabled={loading || !ready} onClick={switchMode}>{mode === "signup" ? "Sign in" : "Create an account"}</button></p>
        </section>
      </div>
      <footer className="auth-footer">{mode === "signup" ? "A few details. Then you’re in." : "LokalChat"}</footer>
    </main>
  );
}
