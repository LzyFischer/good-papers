"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  return <AccountMenu session={session} />;
}

// Signed in: one avatar button with a menu, so the header stays one line.
function AccountMenu({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const meta = session.user.user_metadata ?? {};
  const name: string = meta.full_name || meta.name || meta.user_name || session.user.email || "You";
  const avatar: string | undefined = meta.avatar_url || meta.picture;
  return (
    <span className="auth account" ref={ref}>
      <button className="account-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="account-initial">{name.trim()[0]?.toUpperCase() ?? "?"}</span>
        )}
        <span aria-hidden="true" className="account-caret">▾</span>
        <span className="sr-only">Account menu</span>
      </button>
      {open && (
        <span className="account-menu" role="menu">
          <span className="account-who">{name}</span>
          <Link role="menuitem" href="/welcome?edit=1" onClick={() => setOpen(false)}>Your interests</Link>
          <Link role="menuitem" href="/me" onClick={() => setOpen(false)}>My papers</Link>
          <Link role="menuitem" href="/agents" onClick={() => setOpen(false)}>Your agents</Link>
          <button role="menuitem" onClick={() => browserClient().auth.signOut().then(() => setOpen(false))}>Sign out</button>
        </span>
      )}
    </span>
  );
}
