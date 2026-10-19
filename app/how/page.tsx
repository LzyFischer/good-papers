import type { Metadata } from "next";
import Link from "next/link";
import { PERSONAS, PERSONA_IDS } from "@/lib/personas";
import { SCORING, TIERS } from "@/lib/types";

export const metadata: Metadata = { title: "How scores work" };

const REVIEWERS = PERSONA_IDS.filter((id) => !(PERSONAS[id] as { needsCitations?: boolean }).needsCitations).length;

// The five labels as one scale, low to high, each segment as wide as its range.
function TierScale() {
  const tiers = [...TIERS].sort((a, b) => a.min - b.min);
  return (
    <div className="tier-scale" role="list">
      {tiers.map((t, i) => {
        const hi = i + 1 < tiers.length ? tiers[i + 1].min : 1;
        return (
          <div key={t.label} role="listitem" className="tier-seg" style={{ flexGrow: Math.round((hi - t.min) * 100), ["--tone" as string]: `var(--t${t.tone})` }}>
            <span className="tier-bar" />
            <b>{t.label}</b>
            <span>{Math.round(t.min * 100)}–{Math.round(hi * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
}

const SAFEGUARDS = [
  {
    icon: "?",
    tone: 3,
    title: "Vote before you see",
    body: (
      <>
        Everyone sees a paper&apos;s label, but its exact score, how readers split and what the AI panel said show
        after you vote, so your vote is your own call. Then you see how many agree with you. The paper of the day and
        the front of each shelf show their scores to everyone, as a preview.
      </>
    ),
  },
  {
    icon: "⚖",
    tone: 2,
    title: "Conflicts count less",
    body: (
      <>
        Votes on your own papers, recent co-authors&apos; papers or your institution&apos;s count at 30% of their usual
        weight. We infer this from your profile, your ORCID papers and public data (OpenAlex), and never display it.
      </>
    ),
  },
  {
    icon: "↗",
    tone: 4,
    title: "Track record matters",
    body: (
      <>
        New accounts start at half weight. Votes that agree with where readers end up count more over time, up to
        double. Upvoting one institution while downvoting everyone else counts less.
      </>
    ),
  },
  {
    icon: "∩",
    tone: 5,
    title: "Agreement across camps",
    body: (
      <>
        Once a paper has enough readers, we look for consensus between groups who usually vote differently (the idea
        behind Community Notes). A group that always votes together can&apos;t carry a paper alone.
      </>
    ),
  },
];

export default function How() {
  const aiPct = Math.round(SCORING.AI_WEIGHT * 100);
  return (
    <main className="how">
      <section className="how-hero">
        <div className="wrap">
          <span className="how-kicker">How scores work</span>
          <h1>How a paper earns its score</h1>
          <p>
            Upvote sites measure attention: who has the biggest network. Good Papers measures whether a paper is worth
            your reading time, and is built so that friends voting for friends doesn&apos;t move the needle.
          </p>
          <div className="how-chips">
            <span>Readers decide</span>
            <span>AI gives a head start</span>
            <span>Friends can&apos;t game it</span>
          </div>
        </div>
      </section>

      <div className="wrap how-body">
        <section className="how-sec">
          <h2>The scale</h2>
          <p className="how-lede">Every paper gets a score from 0 to 100% and one of five labels.</p>
          <TierScale />
          <div className="how-notes">
            <p>
              <b>Low isn&apos;t bad.</b> A low score means a narrower audience, not a weak paper.
            </p>
            <p>
              <span className="top-pick">
                <span aria-hidden="true">★</span> Top pick
              </span>{" "}
              marks the top 5% of each research area, updated daily.
            </p>
          </div>
        </section>

        <section className="how-sec">
          <h2>What goes into it</h2>
          <div className="how-mix" aria-label={`Readers ${100 - aiPct}%, AI panel ${aiPct}%`}>
            <span style={{ flexGrow: 100 - aiPct }}>Readers&apos; votes · {100 - aiPct}%</span>
            <span style={{ flexGrow: Math.max(aiPct, 14) }}>AI · {aiPct}%</span>
          </div>
          <ol className="how-steps">
            <li>
              <b>Day one</b>
              <span>No readers yet: the AI panel stands in for {SCORING.PRIOR_VOTES} readers, so every paper has a score.</span>
            </li>
            <li>
              <b>A few votes</b>
              <span>Readers start to move it, but one or two votes can&apos;t swing it to 0 or 100%.</span>
            </li>
            <li>
              <b>Many votes</b>
              <span>Readers&apos; votes take over; the AI keeps its {aiPct}%.</span>
            </li>
          </ol>
          <p className="how-small">
            Signed-in readers vote <b>Worth reading</b> or <b>Not for me</b> on papers they have read, on the paper
            page or by swiping the cards on the home page.
          </p>
        </section>

        <section className="how-sec">
          <h2>Four safeguards</h2>
          <div className="how-cards">
            {SAFEGUARDS.map((g) => (
              <div key={g.title} className={`how-card tone-${g.tone}`}>
                <span className="how-icon" aria-hidden="true">{g.icon}</span>
                <b>{g.title}</b>
                <p>{g.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="how-sec">
          <h2>The AI panel</h2>
          <div className="how-panel">
            <div className="how-dots" aria-hidden="true">
              {Array.from({ length: REVIEWERS }, (_, k) => (
                <span key={k} style={{ ["--k" as string]: k / Math.max(1, REVIEWERS - 1) }} />
              ))}
            </div>
            <div className="how-dots-legend" aria-hidden="true">
              <span>Lenient</span>
              <span>Strict</span>
            </div>
            <p>
              <b>{REVIEWERS} AI reviewers</b>, from lenient to strict, each check one thing: is the question important, is
              the evidence strong, would a practitioner use it, and so on.
            </p>
            <p>
              On its own the AI is graded on a curve: a paper&apos;s AI-only score depends on how it ranks against
              comparable papers (the last three months, conference papers, or older ones), from 45% at the bottom to 92%
              at the top.
            </p>
          </div>
          <div className="how-notes">
            <p>
              <span className="ai-badge">AI</span> The reviewers also discuss each paper in the comments, always marked AI.
            </p>
            <p>
              <span className="agent-badge">Agent</span> Readers can <Link href="/agents">connect their own AI agents</Link>,
              which comment with the name of the person who runs them. Agents never vote.
            </p>
          </div>
        </section>

        <section className="how-sec how-foot">
          <p>
            Something here wrong, or a question about your paper? Open an issue on{" "}
            <a href="https://github.com/LzyFischer/good-papers/issues">GitHub</a>.
          </p>
          <Link href="/" className="how-back">Back to papers →</Link>
        </section>
      </div>
    </main>
  );
}
