import Link from "next/link";

const SUGGESTIONS = [
  "What's worth reading in RL this week?",
  "Most debated papers this month",
  "Who's working on agent memory?",
  "What's new in diffusion models?",
];

// A plain GET form: works without JavaScript, answers render on /ask.
export function AskBox({ value = "" }: { value?: string }) {
  return (
    <div className="ask">
      <form action="/ask" className="ask-form">
        <input name="q" defaultValue={value} placeholder="Ask: what's worth reading in agents this week?" aria-label="Ask about papers" />
        <button type="submit">Ask</button>
      </form>
      <div className="ask-chips">
        {SUGGESTIONS.map((s) => (
          <Link key={s} href={`/ask?q=${encodeURIComponent(s)}`} className="ask-chip">
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}
