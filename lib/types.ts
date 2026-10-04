import type { PersonaId } from "./personas";

export type Paper = {
  id: string; // OpenAlex work id ("W2741809807") or a manual id ("rp-adast-adaptive-coupling")
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  abstract: string | null;
  orgs: string[];
  tags: string[]; // e.g. "Oral", "Findings"
  publishedOn: string | null; // YYYY-MM-DD
};

// One row of the paper_scores view (see supabase/migrations/003_scoring.sql).
export type Score = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  orgs: string[];
  tags: string[];
  area: string | null;
  paper_type: string | null;
  published_on: string | null;
  reader_fresh: number;
  reader_total: number; // fresh + rotten; abstentions are not counted
  reader_abstain: number;
  ai_fresh: number;
  ai_total: number;
  score: number | null; // 0..1, see SCORING below; null when nothing has judged it
};

export type AiVerdict = {
  paper_id: string;
  persona: PersonaId;
  fresh: boolean;
  probability: number;
  take: string | null;
};

// How the headline score is computed (in SQL, the paper_scores view). Keep in sync.
//   ai     = share of the AI panel saying fresh (0.5 if the panel has not run)
//   reader = (reader_fresh + PRIOR_VOTES * ai) / (reader_total + PRIOR_VOTES)
//   score  = AI_WEIGHT * ai + (1 - AI_WEIGHT) * reader
// The AI share acts as PRIOR_VOTES pseudo-votes, so a paper with no readers is
// scored by the AI alone (warm start) and one or two votes cannot swing it to
// 0% or 100%; with many readers their share dominates.
export const SCORING = { AI_WEIGHT: 0.1, PRIOR_VOTES: 5 };

// Headline score needed for the "Fresh" label.
export const FRESH_THRESHOLD = 0.6;
