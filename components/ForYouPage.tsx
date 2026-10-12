"use client";
// The full For you list (up to 100 papers), behind the home shelf's "See all".
import Link from "next/link";
import { signIn, useSession } from "./AuthButton";
import { useForYou } from "./ForYou";
import { MiniCard } from "./Shelf";

export function ForYouPage() {
  const { session, ready } = useSession();
  const { list: r } = useForYou(100);

  if (!ready) return null;
  if (!session)
    return (
      <p className="empty">
        <button className="link-button link-button--strong" onClick={() => signIn()}>Sign in</button> to get papers picked for you.
      </p>
    );
  if (!r) return <p className="empty">Picking papers for you…</p>;
  if (!r.hasTopics)
    return (
      <p className="empty">
        <Link href="/welcome?edit=1&next=/for-you">Pick the topics you follow</Link>, or vote on and read a few papers, and
        your picks show up here.
      </p>
    );
  return (
    <div className="grid-cards">
      {r.papers.map((s) => (
        <div key={s.id} className="card-anchor">
          <MiniCard s={s} why={r.reasons[s.id]} />
        </div>
      ))}
    </div>
  );
}
