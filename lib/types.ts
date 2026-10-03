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

// One row of the paper_scores view (see supabase/schema.sql).
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
  reader_total: number;
  ai_fresh: number;
  ai_total: number;
  rev_fresh: number;
  rev_total: number;
  fresh: number;
  total: number;
};

export type AiVerdict = {
  paper_id: string;
  persona: PersonaId;
  fresh: boolean;
  probability: number;
  take: string | null;
};

// Pooled share of fresh verdicts needed for the headline "Fresh" label.
export const FRESH_THRESHOLD = 0.6;
