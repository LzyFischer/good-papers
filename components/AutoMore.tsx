"use client";
// "Show more" that loads itself: when the button scrolls into view, fetch the next page
// in place (keeping your scroll position). Without JavaScript it's a plain link.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function AutoMore({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  const ref = useRef<HTMLAnchorElement>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(false); // a new page of papers arrived
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setLoading(true);
        router.replace(href, { scroll: false });
      },
      { rootMargin: "600px 0px" }, // start a little before the bottom
    );
    io.observe(el);
    return () => io.disconnect();
  }, [href, router]);
  return (
    <Link ref={ref} href={href} className="load-more" scroll={false} aria-busy={loading}>
      {loading ? "Loading more papers…" : label}
    </Link>
  );
}
