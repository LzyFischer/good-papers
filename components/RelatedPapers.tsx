// "Related papers" at the foot of a paper page: the papers closest in content (SPECTER2
// neighbours), each with its tier and how close it is.
import Link from "next/link";
import { tex } from "@/lib/latex";
import type { Score } from "@/lib/types";
import { tierOf } from "./Score";

export function RelatedPapers({ items }: { items: { s: Score; match: number }[] }) {
  if (!items.length) return null;
  return (
    <section className="related" aria-labelledby="related-h">
      <h2 id="related-h">Related papers</h2>
      <p className="related-note">Closest in content to this one.</p>
      <ol className="related-list">
        {items.map(({ s, match }) => {
          const t = tierOf(s);
          return (
            <li key={s.id}>
              <Link href={`/paper/${s.id}`} className="related-title">
                {tex(s.title)}
                {s.year ? <span className="related-year"> ({s.year})</span> : null}
              </Link>
              {t && <span className={`related-tier tone-${t.tone}`}>{t.label}</span>}
              <span className="related-match">{match}% match</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
