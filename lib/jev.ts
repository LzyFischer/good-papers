// Minimal client for Jev, TypeSafe AI's System One model.
// POST {base}/v1/systemone with { model, state, questions } → { answers, model, usage }.
// JEV_BASE_URL lets you point at any endpoint that speaks the same request format
// (TypeSafe direct by default; compatible hosts such as Cloudflare's Clef also work).

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

export type JevResponse = {
  answers: Record<string, JevAnswer>;
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function jevConfigured() {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

export async function systemOne(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set");
  const base = (process.env.JEV_BASE_URL ?? "https://api.typesafe.ai").replace(/\/$/, "");
  const model = process.env.JEV_MODEL ?? "jev-latest";

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
      cache: "no-store",
    });
    // 429 rate limit, 529 overloaded: back off and retry.
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Jev request failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as JevResponse;
  }
  throw new Error("Jev is overloaded or rate-limited; try again later");
}
