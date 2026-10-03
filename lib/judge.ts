// The AI warm start: one Jev call answers every persona plus the area and type
// questions in parallel against the same state ("ask everything at once").
import { AREAS, PAPER_TYPES } from "./areas";
import { systemOne, type JevQuestion } from "./jev";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "./personas";
import { writeTakes } from "./takes";
import type { Paper } from "./types";

export type Judgement = {
  area: string;
  paperType: string;
  model: string;
  verdicts: { persona: PersonaId; fresh: boolean; probability: number; take: string | null }[];
};

const criteriaOf = (rec: Record<string, { criteria: string }>) =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.criteria]));

export async function judgePaper(paper: Paper, opts: { withTakes?: boolean } = {}): Promise<Judgement> {
  if (!paper.abstract) throw new Error(`No abstract for ${paper.id}; the AI panel needs one`);

  const state = { title: paper.title, abstract: paper.abstract, venue: paper.venue ?? "unknown" };
  const questions: Record<string, JevQuestion> = {
    area: {
      type: "choice",
      instructions: "Which research area best fits the paper described by `title` and `abstract`?",
      criteria: criteriaOf(AREAS),
    },
    paper_type: {
      type: "choice",
      instructions: "What is the main contribution of the paper described by `title` and `abstract`?",
      criteria: criteriaOf(PAPER_TYPES),
    },
  };
  for (const id of PERSONA_IDS) {
    const p = PERSONAS[id];
    questions[`persona_${id}`] = { type: "noul", instructions: p.instructions, criteria: { ...p.criteria } };
  }

  const { answers, model } = await systemOne(state, questions);

  const verdicts = PERSONA_IDS.map((persona) => {
    const a = answers[`persona_${persona}`];
    const probability = a && a.type === "noul" ? a.noul : 0.5;
    return { persona, fresh: probability >= 0.5, probability, take: null as string | null };
  });

  if (opts.withTakes ?? true) {
    try {
      const takes = await writeTakes(paper, verdicts);
      if (takes) for (const v of verdicts) v.take = takes[v.persona] ?? null;
    } catch (e) {
      console.warn("writeTakes failed:", e);
    }
  }

  const area = answers.area?.type === "choice" ? answers.area.choice : "other";
  const paperType = answers.paper_type?.type === "choice" ? answers.paper_type.choice : "method";
  return { area, paperType, model, verdicts };
}

// Run async work over items with a small concurrency limit.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
