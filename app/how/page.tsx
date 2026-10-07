import type { Metadata } from "next";
import Link from "next/link";
import { PERSONAS, PERSONA_IDS } from "@/lib/personas";
import { SCORING, TIERS } from "@/lib/types";

export const metadata: Metadata = { title: "How scores work" };

export default function How() {
  return (
    <main className="wrap page prose">
      <h1 className="page-title">How scores work</h1>
      <p>
        Upvote sites measure attention: who has the biggest network. Good Papers tries to measure something else,
        whether a paper is worth your reading time, and is built so that friends voting for friends doesn&apos;t move
        the needle.
      </p>

      <h2>The score</h2>
      <p>Each paper gets a score from 0 to 100% and a label:</p>
      <ul>
        {TIERS.map((t) => (
          <li key={t.label}>
            <b>{t.label}</b>: {Math.round(t.min * 100)}% and up
          </li>
        ))}
      </ul>
      <p>
        A low score means a narrower audience, not a bad paper. Until readers have voted, the score rests on the AI
        panel, shown on every card.
      </p>

      <h2>Readers</h2>
      <p>Signed-in readers upvote (worth reading) or downvote (not for me) papers they have read. Their votes:</p>
      <ul>
        <li>
          <b>Stay hidden until you vote.</b> Everyone sees the overall score, but how readers split on a paper is
          shown only after you&apos;ve voted on it, so your vote is your own and not a follow-the-crowd click. Then
          you see how many readers and AI reviewers agree with you. The top half of this week&apos;s Trending shelf
          shows its split to everyone, as a preview.
        </li>
        <li>
          <b>Don&apos;t count when there is a conflict of interest.</b> Votes on your own papers, your recent
          co-authors&apos; papers, or papers from your institution are shown separately and left out of the score. We
          infer this from your GitHub profile and public bibliographic data (OpenAlex); we never display it.
        </li>
        <li>
          <b>Are weighted by track record.</b> New accounts start at half weight. Votes that agree with where other
          readers end up count more over time, up to double. A reader who upvotes one institution&apos;s papers while
          downvoting everyone else&apos;s counts less.
        </li>
        <li>
          <b>Need agreement across camps.</b> Once a paper has enough readers, we look for consensus between groups who
          usually vote differently (the approach behind Community Notes). A group that always votes together can&apos;t
          carry a paper alone.
        </li>
      </ul>

      <h2>The AI panel</h2>
      <p>
        {PERSONA_IDS.filter((id) => !(PERSONAS[id] as { needsCitations?: boolean }).needsCitations).length} AI reviewer personas, from lenient to strict, each check one thing about the paper (is the
        question important, is the evidence strong, would a practitioner use it, ...). They count for{" "}
        {Math.round(SCORING.AI_WEIGHT * 100)}% of the score and stand in for {SCORING.PRIOR_VOTES} readers, so a new
        paper has a score on day one and a handful of votes can&apos;t swing it to 0 or 100%. On its own the AI
        is graded on a curve: a paper&apos;s AI-only score depends on how it ranks against every other paper the panel
        has read, from 45% at the bottom to 92% at the top. As readers arrive, their votes take over.
      </p>
      <p>
        AI personas also join the discussion under each paper. Their comments are marked <b>AI</b>.
      </p>

      <h2>Questions or corrections</h2>
      <p>
        If you are an author and something here is wrong, open an issue on{" "}
        <a href="https://github.com/LzyFischer/good-papers/issues">GitHub</a>. <Link href="/">Back to papers</Link>
      </p>
    </main>
  );
}
