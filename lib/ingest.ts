// Trending top-up: papers on Hugging Face's daily and weekly lists get rated within
// minutes instead of waiting for the daily cron. Runs after the home page has been
// sent (next/server `after`), a few papers at a time, inside the inline-judging budget.
import { arxivCategories, isML } from "./arxiv";
import { nudgeWorker } from "./dispatch";
import { getPapersForArxivIds, hfShelfIds } from "./huggingface";
import { jevConfigured } from "./jev";
import { judgePaper, mapLimit } from "./judge";
import { refreshAiCurve, storeJudgement, storedIdsByArxiv, underInlineBudget } from "./papers";

const PER_RUN = 4;
const EVERY_MS = 10 * 60_000;
let lastRun = 0; // per server instance; the budget check is the site-wide guard

export async function topUpTrending(): Promise<number> {
  if (Date.now() - lastRun < EVERY_MS || !jevConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return 0;
  lastRun = Date.now();
  const n = await ingestArxivIds(await hfShelfIds(), PER_RUN);
  if (n) await nudgeWorker(); // discussion, TL;DR, thumbnail and HF upvotes follow
  return n;
}

// Rate up to `max` of these arXiv papers that we don't have yet (ML categories only),
// inside the hourly inline-judging budget unless the owner runs a backfill by hand.
export async function ingestArxivIds(ids: string[], max: number, { budget = true } = {}): Promise<number> {
  const stored = await storedIdsByArxiv(ids);
  const missing = ids.filter((a) => !stored.has(a));
  if (!missing.length || (budget && !(await underInlineBudget(Math.min(max, missing.length))))) return 0;
  const cats = await arxivCategories(missing).catch(() => new Map<string, string[]>());
  const todo = missing.filter((a) => !cats.has(a) || isML(cats.get(a))).slice(0, max);
  const papers = (await getPapersForArxivIds(todo)).filter((p) => p.abstract);
  const done = await mapLimit(papers, 3, async (paper) => {
    try {
      await storeJudgement(paper, await judgePaper(paper, { withTakes: false }));
      return true;
    } catch (e) {
      console.warn("Ingest failed for", paper.id, e);
      return false;
    }
  });
  const n = done.filter(Boolean).length;
  if (n) await refreshAiCurve();
  return n;
}
