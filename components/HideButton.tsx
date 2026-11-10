"use client";
// "Not relevant to me" on a For you card: a small eye-off button in the card's corner (its
// label shows on hover). The card turns into a one-line note with Undo. It hides the paper
// from For you and shows fewer like it; it never changes the paper's score.
import { useSession } from "./AuthButton";
import { hidePaper, unhidePaper, useHidden } from "./hidden";

export function Hideable({ id, children }: { id: string; children: React.ReactNode }) {
  const { session } = useSession();
  const hidden = useHidden(id);
  const uid = session?.user.id;
  if (!uid) return <>{children}</>;
  if (hidden)
    return (
      <div className="mini mini--hidden">
        <p>Hidden. You&apos;ll see fewer papers like this.</p>
        <button className="link-button" onClick={() => unhidePaper(uid, id)}>Undo</button>
      </div>
    );
  return (
    <div className="hideable">
      {children}
      <button className="hide-btn" aria-label="Not relevant to me" data-tip="Not relevant to me" onClick={() => hidePaper(uid, id)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 3l18 18" />
          <path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3.2 4.3M6.6 6.6C4.4 8 2.8 10.2 2 12c1 2.5 5 7 10 7a9.8 9.8 0 0 0 5.4-1.6" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </svg>
      </button>
    </div>
  );
}
