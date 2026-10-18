"use client";
// A paper's abstract, set like the opening of an article: a serif face and a large first
// letter. Long abstracts open folded to a few lines, with a button to read the rest.
import { useEffect, useRef, useState } from "react";

export function Abstract({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);

  // Fold only when the text runs past the folded height.
  useEffect(() => {
    const p = ref.current;
    if (p) setLong(p.scrollHeight > p.clientHeight + 4);
  }, []);

  return (
    <section className="abstract">
      <h2>Abstract</h2>
      <p ref={ref} className={open ? "abstract-text" : "abstract-text abstract-text--folded"}>{children}</p>
      {(long || open) && (
        <button className="abstract-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Read the full abstract"} <span aria-hidden="true">{open ? "↑" : "↓"}</span>
        </button>
      )}
    </section>
  );
}
