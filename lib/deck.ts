// Cards for the home hero's "Would you read it?" deck (components/HeroDeck.tsx), built from
// paper scores on the server (home page, /api/deck) or in the browser (For you).
import { AREAS } from "./areas";
import { TIERS, type Score } from "./types";

export type DeckCard = {
  id: string;
  title: string;
  tldr: string | null;
  thumbnail: string | null;
  area: string | null;
  tier: { label: string; tone: number; pct: number } | null;
  open: boolean; // the score is public anyway (paper of the day, top of Trending)
  kicker: string;
};

export function toDeckCard(s: Score, kicker: string, open = false): DeckCard {
  const tier = s.score === null || s.score === undefined ? null : TIERS.find((t) => s.score! >= t.min) ?? TIERS[TIERS.length - 1];
  return {
    id: s.id,
    title: s.title,
    tldr: s.tldr,
    thumbnail: s.thumbnail,
    area: s.area && AREAS[s.area] ? AREAS[s.area].label : null,
    tier: tier ? { label: tier.label, tone: tier.tone, pct: Math.round(s.score! * 100) } : null,
    open,
    kicker,
  };
}

export const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
