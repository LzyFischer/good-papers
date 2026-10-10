"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase";

// Sends readers to the sign-in page (Google, GitHub or an email code), then back here.
export function signIn() {
  const here = window.location.pathname + window.location.search + window.location.hash;
  window.location.href = `/signin?next=${encodeURIComponent(here)}`;
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const supabase = browserClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, ready };
}

export function AuthButton() {
  const { session, ready } = useSession();
  if (!ready) return <span className="auth" aria-hidden="true" />;
  if (!session) {
    return (
      <button className="auth auth-link" onClick={() => signIn()}>
        Sign in
      </button>
    );
  }
  return (
    <span className="auth">
      <Link href="/welcome?edit=1">Interests</Link>
      <Link href="/me">My papers</Link>
      <button className="auth-link" onClick={() => browserClient().auth.signOut()}>
        Sign out
      </button>
    </span>
  );
}
