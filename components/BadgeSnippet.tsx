"use client";
// "Author of this paper?": the badge (app/badge/[id]) and a Markdown snippet to copy into a
// README or home page. Each badge links back to the paper page.
import { useState } from "react";

export function BadgeSnippet({ id, site }: { id: string; site: string }) {
  const [copied, setCopied] = useState(false);
  const badge = `${site}/badge/${id}.svg`;
  const page = `${site}/paper/${id}`;
  const md = `[![Good Papers](${badge})](${page})`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <details className="badge-snippet">
      <summary>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/badge/${id}.svg`} alt="Good Papers badge" height={20} />
        <span>Author of this paper? Add this badge to your README or page</span>
      </summary>
      <div className="badge-code">
        <code>{md}</code>
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </details>
  );
}
