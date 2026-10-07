// Trending top-up: papers on Hugging Face's daily and weekly lists get rated within
// minutes instead of waiting for the daily cron. Runs after the home page has been
// sent (next/server `after`), a few papers at a time, inside the inline-judging budget.
import { arxivCategories, isML } from "./arxiv";
import { nudgeWorker } from "./dispatch";
import { getHfList, getPapersForArxivIds } from "./huggingface";
import { jevConfigured } from "./jev";
import { judgePaper, mapLimit } from "./judge";
import { storeJudgement, storedIdsByArxiv, underInlineBudget } from "./papers";

const PER_RUN = 4;
const EVERY_MS = 10 * 60_000;
let lastRun = 0; // per server instance; the budget check is the site-wide guard

export async function topUpTrending(): Promise<number> {
  if (Date.now() - lastRun < EVERY_MS || !jevConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return 0;
  lastRun = Date.now();
  // Today's and this week's lists: what the Trending shelf shows by default.
  const ids = [...new Set([...(await getHfList("day", 15)), ...(await getHfList("week", 30))].map((t) => t.arxivId))];
  const stored = await storedIdsByArxiv(ids);
  const missing = ids.filter((a) => !stored.has(a));
  if (!missing.length || !(await underInlineBudget(Math.min(PER_RUN, missing.length)))) return 0;
  const cats = await arxivCategories(missing).catch(() => new Map<string, string[]>());
  const todo = missing.filter((a) => !cats.has(a) || isML(cats.get(a))).slice(0, PER_RUN);
  const papers = (await getPapersForArxivIds(todo)).filter((p) => p.abstract);
  const done = await mapLimit(papers, 2, async (paper) => {
    try {
      await storeJudgement(paper, await judgePaper(paper, { withTakes: false }));
      return true;
    } catch (e) {
      console.warn("Trending top-up failed for", paper.id, e);
      return false;
    }
  });
  const n = done.filter(Boolean).length;
  if (n) await nudgeWorker(); // discussion, TL;DR, thumbnail and HF upvotes follow
  return n;
}
