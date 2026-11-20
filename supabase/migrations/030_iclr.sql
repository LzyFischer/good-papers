-- ICLR standing page (/iclr): public review scores of every submission of a year in review,
-- from Paper Copilot's crawl of OpenReview, refreshed daily by .github/workflows/iclr.yml
-- (scripts/iclr_sync.py). Read-only for readers; written with the service role.
create extension if not exists pg_trgm;

create table if not exists public.iclr_submissions (
  id text primary key,                 -- OpenReview forum id
  year smallint not null,
  title text not null,
  area text,
  ratings real[] not null default '{}',
  confidences real[] not null default '{}',
  outcome text not null default 'pending',   -- pending | withdrawn | desk_rejected | oral | spotlight | poster | rejected
  neighbors text[] not null default '{}',     -- 50 closest submissions of the same year (SPECTER2), closest first
  similar_last jsonb not null default '[]',   -- closest accepted papers of the year before: [{title, ratings, outcome}]
  updated_at timestamptz not null default now()
);
create index if not exists iclr_submissions_title_trgm on public.iclr_submissions using gin (title gin_trgm_ops);
create index if not exists iclr_submissions_year on public.iclr_submissions (year);

-- One row per year: score lookup tables, the density curve, last year's outcomes by rank, the model.
create table if not exists public.iclr_stats (
  year smallint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.iclr_submissions enable row level security;
alter table public.iclr_stats enable row level security;
drop policy if exists "iclr submissions are public" on public.iclr_submissions;
create policy "iclr submissions are public" on public.iclr_submissions for select using (true);
drop policy if exists "iclr stats are public" on public.iclr_stats;
create policy "iclr stats are public" on public.iclr_stats for select using (true);

