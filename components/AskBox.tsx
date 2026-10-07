import Link from "next/link";

const SUGGESTIONS = [
  "What's worth reading in RL this week?",
  "Most debated papers this month",
  "Who's working on agent memory?",
  "What's new in diffusion models?",
];

// A plain GET form: works without JavaScript, answers render on /ask.
export function AskBox({ value = "", dark = false }: { value?: string; dark?: boolean }) {
  return (
    <div className={dark ? "ask ask--dark" : "ask"}>
      <form action="/ask" className="ask-form">
        <input name="q" defaultValue={value} placeholder="Ask anything: what's worth reading in agents this week?" aria-label="Ask about papers" />
        <button type="submit">Ask</button>
      </form>
      <div className="ask-chips">
        <span className="ask-chip ask-chip--featured">
          <span className="ask-chip-badge">New</span>
          <Link href="/neurips">NeurIPS 2026</Link>
          <span aria-hidden="true">·</span>
          <Link href="/neurips?track=oral">Orals</Link>
          <Link href="/neurips?track=spotlight">Spotlights</Link>
          <Link href="/neurips?track=poster">Posters</Link>
        </span>
        {SUGGESTIONS.map((s) => (
          <Link key={s} href={`/ask?q=${encodeURIComponent(s)}`} className="ask-chip">
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}
