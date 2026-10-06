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
  citedByCount: number | null; // from OpenAlex; null for manual papers
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
  cited_by_count: number | null;
  reader_coi: number; // votes from authors, co-authors or colleagues, not counted
  reader_weight: number; // sum of counted readers' reputation weights
  consensus: boolean | null; // true when the cross-camp consensus sets the readers' share
  // Extras filled by the worker (worker/extras.py); null until it has run.
  tldr: string | null;
  panel_consensus: string | null;
  thumbnail: string | null;
  hf_upvotes: number | null;
  github_url: string | null;
  github_stars: number | null;
  comments: number;
};

export type AiVerdict = {
  paper_id: string;
  persona: PersonaId;
  fresh: boolean;
  probability: number;
  take: string | null;
};

// How the headline score is computed (in SQL, the paper_scores view). Keep in sync.
//   ai     = 0.4 + 0.5 * the paper's percentile rank by AI-panel share (0.5 if not judged):
//            graded on a curve, because Jev rarely says no and raw shares bunch up high
//   share  = readers' upvote share: reputation-weighted, without conflict-of-interest
//            votes, or the cross-camp consensus once 8+ readers voted (worker/reputation.py)
//   reader = (share * W + PRIOR_VOTES * ai) / (W + PRIOR_VOTES), W = summed reader weights
//   score  = AI_WEIGHT * ai + (1 - AI_WEIGHT) * reader
// The AI share acts as PRIOR_VOTES pseudo-votes, so a paper with no readers is
// scored by the AI alone (warm start) and one or two votes cannot swing it to
// 0% or 100%; with many readers their share dominates.
export const SCORING = { AI_WEIGHT: 0.1, PRIOR_VOTES: 5 };

// Headline labels, graded so a low score reads as "niche", never as a failure.
export const TIERS = [
  { min: 0.8, label: "Must read", tone: 5 },
  { min: 0.65, label: "Highly rated", tone: 4 },
  { min: 0.5, label: "Worth a look", tone: 3 },
  { min: 0.35, label: "Niche pick", tone: 2 },
  { min: 0, label: "Specialist read", tone: 1 },
] as const;

// Below this many counted readers the headline is marked as an early (mostly AI) read.
export const EARLY_READERS = 5;
