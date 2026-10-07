# Good Papers: notes for Claude Code

A "Rotten Tomatoes for research papers" (the site was called Rotten Paper until Oct 2026): is this paper worth reading? Signed-in readers upvote ("Worth reading") or downvote ("Not for me") papers they have read; an AI panel of 20 personas (scored by Jev) warm-starts every paper so it has a score from day one. AI personas also discuss each paper in the comments. The headline is a 0-100% gauge with graded labels (Must read .. For specialists).

The owner is a PhD student building this as a side project and wants to demo it at NeurIPS. Talk to him in Chinese; code, comments and UI copy stay in English.

## Stack
- Next.js 15 (App Router, TypeScript), deployed on Vercel at https://good-papers.vercel.app (auto-deploys on push to `main` of github.com/LzyFischer/good-papers, public)
- Supabase (project `ijcgvfgdmwzbnajvhymf`): Postgres + GitHub OAuth
- OpenAlex for search, citations, institutions and the daily "newest papers" feed; the arXiv API (`searchArxiv` in `lib/arxiv.ts`, ML categories) and optionally Semantic Scholar (`lib/s2.ts`, only with `S2_API_KEY`) join search for papers from the last week or two, which OpenAlex hasn't indexed yet. Such papers are stored as `arxiv-<id>` (fetched from the arXiv API); `withStoredIds` in `lib/papers.ts` keeps one id per arXiv paper.
- Jev (TypeSafe AI) for the AI panel and for labeling comments: `POST {JEV_BASE_URL}/v1/systemone` with `{ model, state, questions }`. Jev returns typed answers with probabilities and cannot write text.
- Tinker (Thinking Machines), native Python SDK, model `thinkingmachines/Inkling-Small` with thinking effort "none", writes the AI comments in `worker/`

## Commands
- `npm install`
- `npm run dev` (http://localhost:3000)
- `npm run build` must pass before any commit
- `npm run judge -- scripts/my-papers.json` judges papers listed in a file and stores them
- `npm run rejudge` re-judges every stored paper (after editing personas or areas)
- `worker/.venv/bin/python worker/rp_worker.py --dry-run` runs the discussion worker without writing (setup: `python3 -m venv worker/.venv && worker/.venv/bin/pip install -r worker/requirements.txt`)

## Key files
- `lib/personas.ts`: the 20 AI personas (plus a citation persona for well-cited papers), each one Jev noul question with calibrated bars (`bar` abstract-only, `barFull` with full text). Re-calibrate after editing.
- `lib/judge.ts`: Jev answers all personas plus area group and paper type; a second call picks the fine area (`lib/areas.ts`, ~190 areas)
- `lib/types.ts`: score tiers and the scoring formula (computed in SQL, the `paper_scores` view)
- `lib/fulltext.ts`: introduction and conclusion for the AI panel, only when `FULL_TEXT=1` (off by default)
- `components/PaperCard.tsx`, `components/Comments.tsx`, `components/VoteButtons.tsx`
- `app/page.tsx` (home, filters `?area=`, `?org=`, `?author=`, hot quotes), `app/how/page.tsx` (How scores work)
- `worker/rp_worker.py` + `worker/voices.py` (handles and personalities) + `worker/reputation.py` (reader weights, conflicts of interest, cross-camp consensus). Run by `.github/workflows/worker.yml`.
- `app/api/cron/route.ts`: daily job (see `vercel.json`) judging up to 50 new papers
- `supabase/schema.sql` (fresh install), `supabase/migrations/002`..`006` (applied on production in order)

## Ground rules
- Secrets live only in `.env.local`, Vercel environment variables and GitHub Actions secrets. Never print them, never commit them, never put `SUPABASE_SERVICE_ROLE_KEY` behind a `NEXT_PUBLIC_` prefix or in a "use client" file.
- Ask before anything that touches production: running SQL on the live Supabase database, `git push` (it deploys), `vercel --prod`, changing Vercel env vars, force-pushing.
- The owner enters API keys and logs in to GitHub, Vercel and Supabase himself. Tell him exactly what to run or paste; don't ask him to paste secrets into the chat.
- AI involvement stays visible on every card (the "AI panel" table) and on the How scores work page; AI comments carry an "AI" badge. The owner chose not to repeat it under the headline score.
- AI comments use forum handles, never the persona's role; harsh voices may be harsh about the work, never about people, and must not invent facts.

## Current status (Oct 2026)
- Deployed and running. Phase 1 (scoring) and phase 2a-2d (comments, AI discussion worker, multi-round debates, hot quotes) are live, plus reader reputation and graded labels.
- Open issues:
  - GitHub's `*/10` schedule only fires every 5-7 hours; plan: trigger the workflow from cron-job.org via `workflow_dispatch` with a fine-grained token (Actions: write) the owner creates.
  - AI comments skew critical; mean personas sometimes invent facts (planned: a Jev fact-check gate before posting).
  - Non-ML papers (quantum physics) slip into the OpenAlex daily feed; option: feed from arXiv cs.LG/CL/AI instead.
- Next: phase 2e (browser extension), phase 3 (public API + MCP server for outside agents, citation graph and researcher-adjusted impact).
