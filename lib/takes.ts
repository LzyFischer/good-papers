// Jev decides but cannot write. The one-line takes (金句) come from an LLM.
// Optional: without ANTHROPIC_API_KEY the AI panel shows verdicts only.
import { PERSONAS, type PersonaId } from "./personas";
import type { Paper } from "./types";

export function takesConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function writeTakes(
  paper: Paper,
  verdicts: { persona: PersonaId; fresh: boolean }[],
): Promise<Partial<Record<PersonaId, string>> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !paper.abstract) return null;
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

  const lines = verdicts
    .map(
      (v) =>
        `- ${v.persona}: ${PERSONAS[v.persona].name}, who cares about ${PERSONAS[v.persona].focus}. Verdict: ${
          v.fresh ? "FRESH (worth reading)" : "ROTTEN (not worth reading)"
        }`,
    )
    .join("\n");

  const prompt = `You write one-line verdicts for Good Papers, a site where readers upvote or downvote research papers.

Paper title: ${paper.title}
Venue: ${paper.venue ?? "unknown"}
Abstract: ${paper.abstract}

For each reviewer persona below (the panel's strongest supporter and strongest critic), write one sentence (at most 25 words) in that persona's voice that justifies the given verdict. Make it specific to this paper, sharp and quotable, but fair: refer only to what the abstract states, and never invent results, numbers, or flaws it does not support. No hype words, no emojis.

${lines}

Reply with only a JSON object mapping each persona id to its sentence, for example {"method": "..."}.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Anthropic request failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const text: string = (data.content ?? [])
    .map((b: { type: string; text?: string }) => (b.type === "text" ? b.text : ""))
    .join("");
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  const out: Partial<Record<PersonaId, string>> = {};
  for (const v of verdicts) {
    const s = parsed?.[v.persona];
    if (typeof s === "string" && s.trim()) out[v.persona] = s.trim().slice(0, 300);
  }
  return out;
}
