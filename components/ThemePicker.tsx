"use client";
// Readers pick how the site looks. Each theme is a set of colour variables in globals.css
// (:root[data-theme="…"]); the choice lives in this browser and is applied before first
// paint by the script in app/layout.tsx.
import { useEffect, useRef, useState } from "react";

export const THEMES = [
  { key: "classic", label: "Classic", hint: "Night and lime", swatch: ["#111316", "#d2f54a"] },
  { key: "beach", label: "Beach", hint: "Sky, sand and sea", swatch: ["#cfe6f0", "#1b8a8f"] },
] as const;
type Theme = (typeof THEMES)[number]["key"];

export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>("classic");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => setTheme((document.documentElement.dataset.theme as Theme) || "classic"), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (t: Theme) => {
    if (t === "classic") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("gp_theme", t);
    } catch {}
    setTheme(t);
    setOpen(false);
  };

  return (
    <span className="theme-picker" ref={ref}>
      <button className="theme-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Change the look" title="Change the look" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <span className="theme-menu" role="menu">
          {THEMES.map((t) => (
            <button key={t.key} role="menuitemradio" aria-checked={theme === t.key} onClick={() => pick(t.key)}>
              <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }} />
              <span>
                <b>{t.label}</b>
                <small>{t.hint}</small>
              </span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
