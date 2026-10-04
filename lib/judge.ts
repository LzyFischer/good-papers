// The AI warm start. First Jev call: every persona plus the area group and
// paper type, in parallel against the same state ("ask everything at once").
// Second call: the fine-grained area inside the chosen group.
import { AREA_GROUPS, PAPER_TYPES } from "./areas";
import { getFullText } from "./fulltext";
import { systemOne, type JevQuestion } from "./jev";
import { PERSONAS, PERSONA_IDS, spokespersons, type PersonaId } from "./personas";
import { writeTakes } from "./takes";
import type { Paper } from "./types";

export type Verdict = { persona: PersonaId; fresh: boolean; probability: number; take: string | null };

export type Judgement = {
  area: string | null;
  paperType: string;
  model: string;
  textSource: string | null; // where the introduction/conclusion came from; null = abstract only
  verdicts: Verdict[];
};

const criteriaOf = (rec: Record<string, { criteria: string }>) =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.criteria]));

// Citation record for Jev. Citations only ever add evidence: OpenAlex undercounts
// arXiv preprints (many year-old preprints show 0), and Jev reads a low count as a
// strike against the paper. So the record (and the citation persona) is used only
// for papers at least 6 months old with real uptake, MIN_CITES_PER_YEAR or more.
const MIN_CITES_PER_YEAR = 10;

export function citationRecord(paper: Pick<Paper, "citedByCount" | "publishedOn" | "year">, now = Date.now()) {
  if (paper.citedByCount === null || paper.citedByCount === undefined) return null;
  const published = paper.publishedOn ?? (paper.year ? `${paper.year}-07-01` : null);
  if (!published) return null;
  const months = (now - Date.parse(published)) / (30.44 * 86400_000);
  if (!(months >= 6)) return null;
  const perYear = paper.citedByCount / (months / 12);
  if (perYear < MIN_CITES_PER_YEAR) return null;
  return {
    total: paper.citedByCount,
    per_year: Math.round(perYear),
    months_since_publication: Math.round(months),
  };
}

export async function judgePaper(
  paper: Paper,
  opts: { withTakes?: boolean; fullText?: boolean } = {},
): Promise<Judgement> {
  if (!paper.abstract) throw new Error(`No abstract for ${paper.id}; the AI panel needs one`);

  const citations = citationRecord(paper);
  // Full text is off unless FULL_TEXT=1: it costs ~5x the Jev tokens.
  const wantFull = opts.fullText ?? process.env.FULL_TEXT === "1";
  const full = wantFull ? await getFullText(paper).catch(() => null) : null;
  const state = {
    title: paper.title,
    abstract: paper.abstract,
    ...(full ? { introduction: full.introduction, conclusion: full.conclusion ?? "(not found)" } : {}),
    venue: paper.venue ?? "unknown",
    ...(citations ? { citations } : {}),
  };
  const panel = PERSONA_IDS.filter((id) => citations || !(PERSONAS[id] as { needsCitations?: boolean }).needsCitations);
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
  for (const id of panel) {
    const p = PERSONAS[id];
    questions[`persona_${id}`] = { type: "noul", instructions: p.instructions, criteria: { ...p.criteria } };
  }

  const { answers, model } = await systemOne(state, questions);

  const verdicts: Verdict[] = panel.map((persona) => {
    const a = answers[`persona_${persona}`];
    const probability = a && a.type === "noul" ? a.noul : 0.5;
    const p = PERSONAS[persona] as { bar?: number; barFull?: number };
    const bar = (full ? p.barFull : p.bar) ?? 0.5;
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
  return { area, paperType, model, textSource: full?.source ?? null, verdicts };
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
