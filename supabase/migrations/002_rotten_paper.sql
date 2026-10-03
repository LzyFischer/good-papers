-- Upgrade a database that already ran the v1 (Referee) schema to Rotten Paper.
-- Safe to run once in Supabase → SQL Editor.

alter table public.papers
  add column if not exists abstract     text,
  add column if not exists orgs         text[] not null default '{}',
  add column if not exists tags         text[] not null default '{}',
  add column if not exists area         text,
  add column if not exists paper_type   text,
  add column if not exists published_on date;


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

drop view if exists public.paper_scores;
-- Public scores: three tables (readers, AI panel, reviewers) plus the pooled
-- headline. The view runs with its owner's rights, so it counts everyone's
-- ratings while exposing only totals (never who rated, never notes).
create view public.paper_scores as
with r as (
  select paper_id, count(*)::int as total, count(*) filter (where worth_reading)::int as fresh,
         max(updated_at) as last_at
  from public.ratings group by paper_id
), a as (
  select paper_id, count(*)::int as total, count(*) filter (where fresh)::int as fresh,
         max(created_at) as last_at
  from public.ai_verdicts group by paper_id
), v as (
  select paper_id, sum(total)::int as total, sum(fresh)::int as fresh
  from public.reviewer_scores group by paper_id
)
select
  p.id, p.title, p.authors, p.year, p.venue, p.url, p.orgs, p.tags,
  p.area, p.paper_type, p.published_on,
  coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
  coalesce(a.fresh, 0) as ai_fresh,     coalesce(a.total, 0) as ai_total,
  coalesce(v.fresh, 0) as rev_fresh,    coalesce(v.total, 0) as rev_total,
  coalesce(r.fresh, 0) + coalesce(a.fresh, 0) + coalesce(v.fresh, 0) as fresh,
  coalesce(r.total, 0) + coalesce(a.total, 0) + coalesce(v.total, 0) as total,
  greatest(r.last_at, a.last_at, p.created_at) as last_activity
from public.papers p
left join r on r.paper_id = p.id
left join a on a.paper_id = p.id
left join v on v.paper_id = p.id;

grant select on public.paper_scores to anon, authenticated;
