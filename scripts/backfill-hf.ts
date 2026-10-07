// One-off: rate the past year's Hugging Face standouts we don't have yet, so the
// "Past year" shelf is full right away instead of filling 4 papers per 10 minutes.
// Usage: npm run backfill:hf [max]   (counts toward the hourly inline-judging budget)
import { getHfList } from "@/lib/huggingface";
import { ingestArxivIds } from "@/lib/ingest";

(async () => {
  const max = Number(process.argv[2] ?? 60);
  const ids = (await getHfList("year", 60)).map((t) => t.arxivId);
  console.log(`rated ${await ingestArxivIds(ids, max)} new papers`);
})();
