-- Rotten Paper schema (fresh install). Run once in Supabase → SQL Editor.
-- Already ran the v1 schema? Run migrations/002_rotten_paper.sql instead.

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
  worth_reading boolean not null,
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
