"use client";
// Sign in with Google, GitHub, or a 6-digit code sent by email (no passwords).
import { useState } from "react";
import { browserClient } from "@/lib/supabase";

type Provider = "google" | "github";

export function SignIn({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => `${window.location.origin}${next}`;

  async function oauth(provider: Provider) {
    setBusy(true);
    setError(null);
    const { error } = await browserClient().auth.signInWithOAuth({ provider, options: { redirectTo: back() } });
    if (error) {
      setBusy(false);
      setError(`Couldn't start sign-in: ${error.message}`);
    }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    setBusy(true);
    setError(null);
    const { error } = await browserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: back() },
    });
    setBusy(false);
    if (error) return setError(`Couldn't send the code: ${error.message}`);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setError("Enter the 6-digit code from the email.");
    setBusy(true);
    setError(null);
    const { error } = await browserClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return setError("That code didn't work. Check it, or send a new one.");
    window.location.href = next;
  }

  return (
    <div className="signin">
      <h1>Sign in to Good Papers</h1>
      <p className="signin-sub">Vote on papers you&apos;ve read, join the discussion, and see how others rated them.</p>

      {step === "email" ? (
        <>
          <button className="signin-btn" disabled={busy} onClick={() => oauth("google")}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
              <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
            </svg>
            Continue with Google
          </button>
          <button className="signin-btn" disabled={busy} onClick={() => oauth("github")}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
              <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" />
            </svg>
            Continue with GitHub
          </button>

          <div className="signin-or"><span>or</span></div>

          <form onSubmit={sendCode} className="signin-form">
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="you@university.edu"
              autoComplete="email"
              aria-label="Email address"
            />
            <button className="signin-primary" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
          </form>
        </>
      ) : (
        <form onSubmit={verify} className="signin-form">
          <p className="signin-sub">
            We sent a 6-digit code to <b>{email}</b>. It expires in an hour.
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ""));
              setError(null);
            }}
            placeholder="123456"
            aria-label="6-digit code"
            className="signin-code"
            autoFocus
          />
          <button className="signin-primary" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
          >
            Use a different email
          </button>
        </form>
      )}

      {error && <p className="signin-error" role="alert">{error}</p>}
      <p className="signin-fine">New here? Signing in creates your account. We only use your email to sign you in.</p>
    </div>
  );
}
