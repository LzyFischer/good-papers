"use client";
// "On this page": the sections of a long page (How scores work, Agents), sticky beside the
// text on wide screens, with the section in view highlighted.
import { useEffect, useState } from "react";

export function PageToc({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = items.find((it) => seen.get(it.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-15% 0px -60% 0px" },
    );
    for (const it of items) {
      const el = document.getElementById(it.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [items]);
  return (
    <nav className="page-toc" aria-label="On this page">
      <span>On this page</span>
      {items.map((it) => (
        <a key={it.id} href={`#${it.id}`} aria-current={active === it.id ? "true" : undefined}>
          {it.label}
        </a>
      ))}
    </nav>
  );
}
