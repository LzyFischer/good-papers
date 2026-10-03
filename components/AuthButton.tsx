"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase";

export function signIn() {
  return browserClient().auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: window.location.href },
  });
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
        Sign in with GitHub
      </button>
    );
  }
  return (
    <span className="auth">
      <Link href="/me">My papers</Link>
      <button className="auth-link" onClick={() => browserClient().auth.signOut()}>
        Sign out
      </button>
    </span>
  );
}
