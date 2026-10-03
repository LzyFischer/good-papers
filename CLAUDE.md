# Rotten Paper: notes for Claude Code

A "Rotten Tomatoes for research papers". Each paper gets binary verdicts (fresh/rotten) from three tables: signed-in readers, an AI panel (five personas scored by Jev), and conference reviewers. The headline score pools all three, so new papers have a score from day one.

The owner is a PhD student building this as a side project and wants to demo it at NeurIPS. Talk to him in Chinese; code, comments and UI copy stay in English.

## Stack
- Next.js 15 (App Router, TypeScript), deployed on Vercel
- Supabase: Postgres + GitHub OAuth
- OpenAlex API for paper search and the daily "newest papers" feed
- Jev (TypeSafe AI) for AI panel verdicts: `POST {JEV_BASE_URL}/v1/systemone` with `{ model, state, questions }`. Jev returns typed answers with probabilities and cannot write text.
- Anthropic API (optional) writes the one-line takes, because Jev can't

## Commands
- `npm install`
- `npm run dev` (http://localhost:3000)
- `npm run build` must pass before any commit
- `npm run judge -- scripts/my-papers.json` judges papers listed in a file and stores them

## Key files
- `lib/personas.ts`: the five AI personas, each one Jev noul question. Edit here to change reviewing style.
- `lib/judge.ts`: one Jev call answers all personas plus area and paper type
- `lib/jev.ts`, `lib/takes.ts`, `lib/openalex.ts`, `lib/papers.ts`
- `components/PaperCard.tsx`: the card with three tables, vote buttons, AI panel
- `app/api/cron/route.ts`: daily job (see `vercel.json`); `app/api/judge/route.ts`: judge given ids
- `supabase/schema.sql` (fresh install), `supabase/migrations/002_rotten_paper.sql` (upgrade from v1)

## Ground rules
- Secrets live only in `.env.local` and Vercel environment variables. Never print them, never commit them, never put `SUPABASE_SERVICE_ROLE_KEY` behind a `NEXT_PUBLIC_` prefix or in a "use client" file.
- Ask before anything that touches production: running SQL on the live Supabase database, `vercel --prod`, changing Vercel env vars, force-pushing.
- The owner enters API keys and logs in to GitHub, Vercel and Supabase himself. Tell him exactly what to run or paste; don't ask him to paste secrets into the chat.
- AI panel scores stay visibly marked as including AI ("AI panel included" under the headline score).

## Current status (Oct 2026)
- v1 (named Referee) ran locally against Supabase. v2 code is here but not yet deployed.
- Next steps, in order:
  1. Run `supabase/migrations/002_rotten_paper.sql` on the existing database.
  2. Fill `.env.local` from `.env.example`.
  3. `npm run build`, then `npm run dev` and check the home, search and paper pages.
  4. Replace the placeholder abstracts in `scripts/my-papers.json` (AdaST, MemSuit, TeacherGRPO, BrainTAP) with real ones, then run `npm run judge`.
  5. Push to GitHub and deploy on Vercel; update Supabase redirect URLs and the GitHub OAuth homepage URL.
  6. Trigger `/api/cron` once with the `CRON_SECRET` bearer token to confirm the daily job.
- The Jev client was tested only against a mock server. If the real API rejects a field, check https://docs.typesafe.ai and fix `lib/jev.ts`.
