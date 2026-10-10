"use client";
// First sign-in: send new readers to the welcome page once (they can skip everything there).
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "./AuthButton";
import { getPrefs } from "./prefs";

export function Onboarding() {
  const { session } = useSession();
  const path = usePathname();
  useEffect(() => {
    if (!session || path.startsWith("/welcome") || path.startsWith("/signin")) return;
    const key = `gp-welcomed-${session.user.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      /* storage blocked: check the database every time */
    }
    getPrefs(session.user.id).then((p) => {
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        /* ignore */
      }
      if (!p) window.location.href = `/welcome?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    });
  }, [session, path]);
  return null;
}
