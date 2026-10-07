"use client";
// Share a paper: the system share sheet on phones, otherwise copy the link, post on X,
// or save the share card (app/paper/[id]/opengraph-image.tsx).
import { useState } from "react";

export function ShareButton({ id, title, pct }: { id: string; title: string; pct: number | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? `/paper/${id}` : `${window.location.origin}/paper/${id}`;
  const text = pct === null ? `${title}` : `${pct}% on Good Papers: ${title}`;

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        /* cancelled: fall through to the menu */
      }
    }
    setOpen((o) => !o);
  }

  return (
    <span className="share">
      <button className="share-btn" onClick={share} aria-expanded={open}>
        Share
      </button>
      {open && (
        <span className="share-menu" role="menu">
          <button
            role="menuitem"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          <a role="menuitem" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">
            Post on X
          </a>
          <a role="menuitem" href={`/paper/${id}/opengraph-image`} download={`good-papers-${id}.png`}>
            Save image
          </a>
        </span>
      )}
    </span>
  );
}
