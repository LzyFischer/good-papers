// The AI warm start. First Jev call: every persona plus the area group and
// paper type, in parallel against the same state ("ask everything at once").
// Second call: the fine-grained area inside the chosen group.
import { AREA_GROUPS, PAPER_TYPES } from "./areas";
import { systemOne, type JevQuestion } from "./jev";
import { PERSONAS, PERSONA_IDS, spokespersons, type PersonaId } from "./personas";
import { writeTakes } from "./takes";
import type { Paper } from "./types";

export type Verdict = { persona: PersonaId; fresh: boolean; probability: number; take: string | null };

export type Judgement = {
  area: string | null;
  paperType: string;
  model: string;
  verdicts: Verdict[];
};

const criteriaOf = (rec: Record<string, { criteria: string }>) =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.criteria]));

export async function judgePaper(paper: Paper, opts: { withTakes?: boolean } = {}): Promise<Judgement> {
  if (!paper.abstract) throw new Error(`No abstract for ${paper.id}; the AI panel needs one`);

  const state = { title: paper.title, abstract: paper.abstract, venue: paper.venue ?? "unknown" };
  const questions: Record<string, JevQuestion> = {
    area_group: {
      type: "choice",
      instructions: "Which research area best fits the paper described by `title` and `abstract`?",
      criteria: criteriaOf(AREA_GROUPS),
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

  const verdicts: Verdict[] = PERSONA_IDS.map((persona) => {
    const a = answers[`persona_${persona}`];
    const probability = a && a.type === "noul" ? a.noul : 0.5;
    const bar: number = (PERSONAS[persona] as { bar?: number }).bar ?? 0.5;
    return { persona, fresh: probability >= bar, probability, take: null };
  });

  const group = answers.area_group?.type === "choice" ? answers.area_group.choice : "other";
  let area: string | null = null;
  const fine = AREA_GROUPS[group]?.areas ?? {};
  if (Object.keys(fine).length > 0) {
    try {
      const second = await systemOne(state, {
        area: {
          type: "choice",
          instructions: "Which topic best fits the paper described by `title` and `abstract`?",
          criteria: fine,
        },
      });
      const a = second.answers.area;
      area = a?.type === "choice" && a.choice in fine ? a.choice : null;
    } catch (e) {
      console.warn("Area lookup failed:", e);
    }
  }

  if (opts.withTakes ?? true) {
    try {
      const speakers = spokespersons(verdicts);
      const takes = await writeTakes(paper, speakers);
      if (takes) for (const v of verdicts) v.take = takes[v.persona] ?? null;
    } catch (e) {
      console.warn("writeTakes failed:", e);
    }
  }

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
