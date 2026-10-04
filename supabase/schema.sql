-- Rotten Paper schema (fresh install). Run once in Supabase → SQL Editor.
-- Already ran the v1 schema? Run migrations/002_rotten_paper.sql, then 003_scoring.sql.

create table public.papers (
  id           text primary key,          -- OpenAlex id (W…) or manual id (rp-…)
  title        text not null,
  authors      text[] not null default '{}',
  year         int,
  venue        text,
  url          text,
  abstract     text,
  orgs         text[] not null default '{}',
  tags         text[] not null default '{}',   -- e.g. Oral, Findings
  area         text,                           -- set by Jev, see lib/areas.ts
  paper_type   text,
  published_on date,
  created_at   timestamptz not null default now()
);

-- Signed-in readers: one binary verdict per paper, plus a private note.
create table public.ratings (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paper_id      text not null references public.papers(id) on delete cascade,
  worth_reading boolean,                    -- null: read it, no verdict
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, paper_id)
);
create index ratings_paper_idx on public.ratings (paper_id);

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger ratings_touch before update on public.ratings
for each row execute function public.touch_updated_at();

alter table public.papers  enable row level security;
alter table public.ratings enable row level security;

create policy "papers are public" on public.papers
  for select to anon, authenticated using (true);
create policy "signed-in users add papers" on public.papers
  for insert to authenticated with check (true);

create policy "read own ratings" on public.ratings
  for select to authenticated using (auth.uid() = user_id);
create policy "add own ratings" on public.ratings
  for insert to authenticated with check (auth.uid() = user_id);
create policy "edit own ratings" on public.ratings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own ratings" on public.ratings
  for delete to authenticated using (auth.uid() = user_id);

-- AI panel: one verdict per persona per paper, written only by the server.
create table if not exists public.ai_verdicts (
  paper_id    text not null references public.papers(id) on delete cascade,
  persona     text not null,
  fresh       boolean not null,
  probability real not null,          -- Jev's yes probability
  take        text,                   -- one-line take from the LLM, may be null
  model       text,                   -- e.g. jev-1.13.0
  created_at  timestamptz not null default now(),
  primary key (paper_id, persona)
);

-- Conference reviewers, imported (e.g. from OpenReview) or entered manually.
create table if not exists public.reviewer_scores (
  paper_id text not null references public.papers(id) on delete cascade,
  source   text not null,             -- 'openreview', 'manual', ...
  fresh    int not null check (fresh >= 0),
  total    int not null check (total >= fresh),
  note     text,
  primary key (paper_id, source)
);

alter table public.ai_verdicts     enable row level security;
alter table public.reviewer_scores enable row level security;

drop policy if exists "ai verdicts are public" on public.ai_verdicts;
create policy "ai verdicts are public" on public.ai_verdicts
  for select to anon, authenticated using (true);
drop policy if exists "reviewer scores are public" on public.reviewer_scores;
create policy "reviewer scores are public" on public.reviewer_scores
  for select to anon, authenticated using (true);

-- Public scores: readers and AI panel plus the headline score (see SCORING in lib/types.ts).
-- The view runs with its owner's rights, so it counts everyone's ratings while
-- exposing only totals (never who rated, never notes).
create view public.paper_scores as
with r as (
  select paper_id,
         count(worth_reading)::int                           as total,   -- fresh + rotten
         count(*) filter (where worth_reading)::int          as fresh,
         count(*) filter (where worth_reading is null)::int  as abstain,
         max(updated_at)                                     as last_at
  from public.ratings group by paper_id
), a as (
  select paper_id, count(*)::int as total, count(*) filter (where fresh)::int as fresh,
         max(created_at) as last_at
  from public.ai_verdicts group by paper_id
), s as (
  select p.*,
         coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
         coalesce(r.abstain, 0) as reader_abstain,
         coalesce(a.fresh, 0) as ai_fresh, coalesce(a.total, 0) as ai_total,
         case when a.total > 0 then a.fresh::float8 / a.total else 0.5 end as prior,
         greatest(r.last_at, a.last_at, p.created_at) as last_activity
  from public.papers p
  left join r on r.paper_id = p.id
  left join a on a.paper_id = p.id
)
select
  id, title, authors, year, venue, url, orgs, tags, area, paper_type, published_on,
  reader_fresh, reader_total, reader_abstain, ai_fresh, ai_total,
  case when reader_total = 0 and ai_total = 0 then null
       else 0.1 * prior + 0.9 * (reader_fresh + 5 * prior) / (reader_total + 5)
  end as score,
  last_activity
from s;

grant select on public.paper_scores to anon, authenticated;
