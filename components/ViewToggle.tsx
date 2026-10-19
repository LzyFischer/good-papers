"use client";
// All papers: one big card per row ("list") or a grid of small cards ("grid"). The choice is
// a cookie, so the server renders the right layout on the next visit too.
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { VIEW_COOKIE, type View } from "@/lib/view";


export function ViewToggle({ view }: { view: View }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function pick(v: View) {
    if (v === view) return;
    document.cookie = `${VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  }
  return (
    <span className="view-toggle" role="group" aria-label="Layout" data-pending={pending || undefined}>
      <button aria-pressed={view === "list"} title="Big cards" onClick={() => pick("list")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /></svg>
      </button>
      <button aria-pressed={view === "grid"} title="Grid" onClick={() => pick("grid")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" /></svg>
      </button>
    </span>
  );
}
