// Original Rotten Paper icon set, rendered once as an SVG sprite in the layout.
export type IconName = "fresh" | "rotten" | "pending" | "readers" | "ai" | "reviewer" | "brand";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} aria-hidden="true">
      <use href={`#ic-${name}`} />
    </svg>
  );
}

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {/* Fresh: crisp page with a sprout */}
        <symbol id="ic-fresh" viewBox="0 0 48 48">
          <path d="M12 6h17l9 9v27a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="var(--surface)" stroke="var(--fresh)" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M29 6v9h9" fill="none" stroke="var(--fresh)" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M24 38V27" stroke="var(--fresh)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M24 29c0-5-4-8-9-8 0 5 4 8 9 8z" fill="var(--fresh)" />
          <path d="M24 27c0-4 3-7 8-7 0 4-3 7-8 7z" fill="var(--fresh)" opacity=".7" />
        </symbol>
        {/* Rotten: crumpled, yellowed page with mold spots */}
        <symbol id="ic-rotten" viewBox="0 0 48 48">
          <path d="M11 7l7 2 6-3 7 3 6-1 1 9-2 6 3 7-2 7 1 6-8 1-6-2-6 2-7-1 1-7-2-6 2-7-2-6z" fill="var(--rotten-soft)" stroke="var(--rotten)" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M16 16l5 4M30 14l-3 6M18 32l6-3 5 4" fill="none" stroke="var(--rotten)" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
          <circle cx="31" cy="30" r="4" fill="var(--mold)" />
          <circle cx="35" cy="25" r="2" fill="var(--mold)" opacity=".8" />
          <circle cx="17" cy="24" r="2.5" fill="var(--mold)" opacity=".85" />
        </symbol>
        {/* Pending: blank dashed page */}
        <symbol id="ic-pending" viewBox="0 0 48 48">
          <path d="M12 6h17l9 9v27a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeDasharray="4 3" strokeLinejoin="round" />
          <path d="M20 22a4 4 0 1 1 6 3.5c-1.3.8-2 1.6-2 3M24 33v.5" fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeLinecap="round" />
        </symbol>
        {/* Readers: wax seal with a check */}
        <symbol id="ic-readers" viewBox="0 0 48 48">
          <path d="M24 5l4 3.5 5-1 2 4.7 4.8 1.8-.8 5L42 23l-3 4 .8 5-4.8 1.8-2 4.7-5-1L24 41l-4-3.5-5 1-2-4.7-4.8-1.8.8-5L6 23l3-4-.8-5 4.8-1.8 2-4.7 5 1z" fill="var(--ink)" />
          <path d="M17 23.5l5 5 9-10" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        {/* AI panel: a judges' bench */}
        <symbol id="ic-ai" viewBox="0 0 48 48">
          <rect x="6" y="28" width="36" height="12" rx="3" fill="var(--ai)" />
          <circle cx="14" cy="20" r="5" fill="none" stroke="var(--ai)" strokeWidth="2.5" />
          <circle cx="24" cy="17" r="6" fill="var(--ai)" />
          <circle cx="34" cy="20" r="5" fill="none" stroke="var(--ai)" strokeWidth="2.5" />
          <circle cx="22" cy="16.5" r="1.2" fill="var(--ai-soft)" />
          <circle cx="26" cy="16.5" r="1.2" fill="var(--ai-soft)" />
          <path d="M24 6v4" stroke="var(--ai)" strokeWidth="2.5" strokeLinecap="round" />
        </symbol>
        {/* Reviewers: fountain-pen nib */}
        <symbol id="ic-reviewer" viewBox="0 0 48 48">
          <path d="M24 6l10 14-10 22-10-22z" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M24 26v16" stroke="var(--ink)" strokeWidth="2" />
          <circle cx="24" cy="24" r="3" fill="var(--ink)" />
        </symbol>
        {/* Brand: half fresh, half rotten page */}
        <symbol id="ic-brand" viewBox="0 0 48 48">
          <path d="M10 6h18l10 10v26a2 2 0 0 1-2 2H10z" fill="#f2f4f6" />
          <path d="M24 6h4l10 10v26a2 2 0 0 1-2 2H24z" fill="#e2c98a" />
          <circle cx="31" cy="31" r="3.5" fill="#7c8a3a" />
          <circle cx="34" cy="24" r="1.8" fill="#7c8a3a" />
          <path d="M17 34v-8" stroke="#2f8a3e" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M17 28c0-4-3-6-7-6 0 4 3 6 7 6z" fill="#2f8a3e" />
        </symbol>
      </defs>
    </svg>
  );
}
