// One-off: rate the papers on Hugging Face's lists we don't have yet, so the Trending
// shelf is full right away instead of filling 4 papers per 10 minutes.
// Usage: npm run backfill:hf [max]   (counts toward the hourly inline-judging budget)
import { hfShelfIds } from "@/lib/huggingface";
import { ingestArxivIds } from "@/lib/ingest";

(async () => {
  const max = Number(process.argv[2] ?? 100);
  const ids = await hfShelfIds();
  console.log(`rated ${await ingestArxivIds(ids, max)} new papers`);
})();
