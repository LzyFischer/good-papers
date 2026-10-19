-- Good Papers schema (fresh install). Run once in Supabase → SQL Editor.
-- Already ran the v1 schema? Run migrations/002 through 006 in order instead.

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
  cited_by_count int,                         -- from OpenAlex, refreshed by the cron
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
  last_activity,
  cited_by_count
from s;

grant select on public.paper_scores to anon, authenticated;


-- ===== Phase 2 (same as migrations/005_comments.sql) =====

-- Phase 2: discussion under each paper. Signed-in readers comment and reply;
-- the AI panel (worker/, Inkling-Small on Tinker) seeds discussions and answers
-- readers; Jev labels every comment's stance and how quotable it is, which feeds
-- the hot-quotes board. Safe to run once after 004.

create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  paper_id     text not null references public.papers(id) on delete cascade,
  parent_id    uuid references public.comments(id) on delete cascade, -- one level of replies
  author_kind  text not null default 'user' check (author_kind in ('user', 'ai')),
  user_id      uuid default auth.uid() references auth.users(id) on delete cascade,
  author_name  text,                 -- GitHub login for readers (set by trigger), persona name for AI
  persona      text,                 -- AI persona id (lib/personas.ts)
  body         text not null check (char_length(body) between 1 and 2000),
  stance       text check (stance in ('fresh', 'rotten', 'neutral')), -- set by Jev
  quote_score  real,                 -- Jev: how sharp and quotable, 0..1
  needs_reply  boolean not null default false, -- reader comments waiting for an AI reply
  created_at   timestamptz not null default now(),
  check ((author_kind = 'user') = (user_id is not null))
);
create index if not exists comments_paper_idx on public.comments (paper_id, created_at);
create index if not exists comments_pending_idx on public.comments (created_at) where needs_reply;

create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- Readers can't choose their display name or skip the AI reply queue.
create or replace function public.comments_fill_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_kind = 'user' then
    select coalesce(raw_user_meta_data->>'user_name', raw_user_meta_data->>'name', 'reader')
      into new.author_name from auth.users where id = new.user_id;
    new.needs_reply := true;
  end if;
  return new;
end $$;
drop trigger if exists comments_fill_author on public.comments;
create trigger comments_fill_author before insert on public.comments
  for each row execute function public.comments_fill_author();

alter table public.comments      enable row level security;
alter table public.comment_likes enable row level security;

drop policy if exists "comments are public" on public.comments;
create policy "comments are public" on public.comments for select to anon, authenticated using (true);
drop policy if exists "readers add own comments" on public.comments;
create policy "readers add own comments" on public.comments for insert to authenticated
  with check (author_kind = 'user' and user_id = auth.uid() and persona is null
              and stance is null and quote_score is null);
drop policy if exists "readers delete own comments" on public.comments;
create policy "readers delete own comments" on public.comments for delete to authenticated
  using (user_id = auth.uid());
-- No update policy: edits go through delete and re-post. AI rows are written with the service role.

drop policy if exists "likes are public" on public.comment_likes;
create policy "likes are public" on public.comment_likes for select to anon, authenticated using (true);
drop policy if exists "readers like" on public.comment_likes;
create policy "readers like" on public.comment_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "readers unlike" on public.comment_likes;
create policy "readers unlike" on public.comment_likes for delete to authenticated using (user_id = auth.uid());

-- Comments with like and reply counts. Runs with its owner's rights so counts
-- include everyone; exposes no user ids beyond what comments already shows.
drop view if exists public.comment_feed;
create view public.comment_feed as
select c.id, c.paper_id, c.parent_id, c.author_kind, c.user_id, c.author_name, c.persona,
       c.body, c.stance, c.quote_score, c.created_at,
       (select count(*) from public.comment_likes l where l.comment_id = c.id)::int as likes,
       (select count(*) from public.comments r where r.parent_id = c.id)::int as replies
from public.comments c;
grant select on public.comment_feed to anon, authenticated;


-- ===== Reputation (same as migrations/006_reputation.sql) =====

-- Reader reputation, conflicts of interest, cross-camp consensus, and a
-- graded comment stance. All weights and flags are computed by the worker
-- (worker/reputation.py) with the service role; readers can't see or edit them.
-- Safe to run once after 005. The paper_scores view keeps its old columns and
-- appends new ones, so the deployed site keeps working until new code ships.

-- Per-reader vote weight and what we inferred about them (never shown publicly).
create table if not exists public.reader_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  github_login   text,
  openalex_author text,            -- inferred only when name and institution both match
  institutions   text[] not null default '{}',
  coauthors      text[] not null default '{}',
  weight         real not null default 0.5,  -- vote weight, 0.1 .. 2
  votes          int not null default 0,
  agreement      real,             -- share of votes agreeing with the consensus of others
  favoritism     real,             -- 0 .. 1, upvotes concentrated on one institution
  updated_at     timestamptz not null default now()
);
alter table public.reader_profiles enable row level security; -- no policies: service role only

-- Votes that don't count toward the score: authors, co-authors, same institution.
create table if not exists public.vote_coi (
  user_id  uuid not null references auth.users(id) on delete cascade,
  paper_id text not null references public.papers(id) on delete cascade,
  reason   text not null,          -- 'author' | 'coauthor' | 'institution'
  primary key (user_id, paper_id)
);
alter table public.vote_coi enable row level security; -- no policies: service role only

-- Cross-camp ("bridging") consensus per paper, Community Notes style.
create table if not exists public.paper_consensus (
  paper_id   text primary key references public.papers(id) on delete cascade,
  bridged    real not null,        -- reader share after removing camp effects, 0..1
  raters     int not null,
  updated_at timestamptz not null default now()
);
alter table public.paper_consensus enable row level security;
drop policy if exists "consensus is public" on public.paper_consensus;
create policy "consensus is public" on public.paper_consensus for select to anon, authenticated using (true);

-- Graded comment stance (Jev): love, like, mixed, doubt, critical. Old labels are re-scored.
alter table public.comments drop constraint if exists comments_stance_check;
update public.comments set stance = null, quote_score = null where stance in ('fresh', 'rotten', 'neutral');
alter table public.comments add constraint comments_stance_check
  check (stance in ('love', 'like', 'mixed', 'doubt', 'critical'));

-- Scores: reader votes are weighted by reputation, conflict-of-interest votes
-- are left out, and once a paper has enough raters the cross-camp consensus
-- replaces the plain weighted share. Readers without a profile yet weigh 0.5.
create or replace view public.paper_scores as
with r as (
  select ra.paper_id,
         count(ra.worth_reading) filter (where c.user_id is null)::int                 as total,
         count(*) filter (where ra.worth_reading and c.user_id is null)::int           as fresh,
         count(*) filter (where ra.worth_reading is null)::int                         as abstain,
         count(*) filter (where ra.worth_reading is not null and c.user_id is not null)::int as coi,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading is not null and c.user_id is null), 0) as total_w,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading and c.user_id is null), 0)             as fresh_w,
         max(ra.updated_at) as last_at
  from public.ratings ra
  left join public.vote_coi c on c.user_id = ra.user_id and c.paper_id = ra.paper_id
  left join public.reader_profiles w on w.user_id = ra.user_id
  group by ra.paper_id
), a as (
  select paper_id, count(*)::int as total, count(*) filter (where fresh)::int as fresh,
         max(created_at) as last_at
  from public.ai_verdicts group by paper_id
), s as (
  select p.*,
         coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
         coalesce(r.abstain, 0) as reader_abstain,
         coalesce(a.fresh, 0) as ai_fresh, coalesce(a.total, 0) as ai_total,
         -- The AI alone only vouches: its share maps into 50..100%; only readers can rate a paper below 50%.
         case when a.total > 0 then 0.5 + 0.5 * a.fresh::float8 / a.total else 0.5 end as prior,
         coalesce(r.total_w, 0)::float8 as total_w,
         coalesce(r.fresh_w, 0)::float8 as fresh_w,
         coalesce(r.coi, 0) as reader_coi,
         pc.bridged, pc.raters,
         greatest(r.last_at, a.last_at, p.created_at) as last_activity
  from public.papers p
  left join r on r.paper_id = p.id
  left join a on a.paper_id = p.id
  left join public.paper_consensus pc on pc.paper_id = p.id
), t as (
  select s.*,
         case when raters >= 8 then bridged
              when total_w > 0 then fresh_w / total_w
              else prior end as reader_share
  from s
)
select
  id, title, authors, year, venue, url, orgs, tags, area, paper_type, published_on,
  reader_fresh, reader_total, reader_abstain, ai_fresh, ai_total,
  case when reader_total = 0 and ai_total = 0 then null
       else 0.1 * prior + 0.9 * (reader_share * total_w + 5 * prior) / (total_w + 5)
  end as score,
  last_activity,
  cited_by_count,
  reader_coi,
  round(total_w::numeric, 2)::float8 as reader_weight,
  (raters >= 8) as consensus
from t;

grant select on public.paper_scores to anon, authenticated;


-- ===== Paper extras (same as migrations/007_paper_extras.sql) =====

-- Extras shown on cards and paper pages, filled by the worker (worker/extras.py):
-- a one-line TL;DR and the panel consensus (Inkling-Small), the first figure from
-- the arXiv HTML page as a thumbnail, and Hugging Face upvotes / GitHub stars.
-- Safe to run once after 006; the view only appends columns.

alter table public.papers
  add column if not exists tldr               text,
  add column if not exists panel_consensus    text,   -- one sentence summing up the discussion
  add column if not exists consensus_comments int,    -- comment count when it was written
  add column if not exists thumbnail          text,   -- image URL (arxiv.org/html/...)
  add column if not exists hf_upvotes         int,
  add column if not exists github_url         text,
  add column if not exists github_stars       int,
  add column if not exists extras_checked_at  timestamptz;

create index if not exists ratings_updated_idx on public.ratings (updated_at);
create index if not exists comments_created_idx on public.comments (created_at);

create or replace view public.paper_scores as
with r as (
  select ra.paper_id,
         count(ra.worth_reading) filter (where c.user_id is null)::int                 as total,
         count(*) filter (where ra.worth_reading and c.user_id is null)::int           as fresh,
         count(*) filter (where ra.worth_reading is null)::int                         as abstain,
         count(*) filter (where ra.worth_reading is not null and c.user_id is not null)::int as coi,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading is not null and c.user_id is null), 0) as total_w,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading and c.user_id is null), 0)             as fresh_w,
         max(ra.updated_at) as last_at
  from public.ratings ra
  left join public.vote_coi c on c.user_id = ra.user_id and c.paper_id = ra.paper_id
  left join public.reader_profiles w on w.user_id = ra.user_id
  group by ra.paper_id
), a as (
  select paper_id, count(*)::int as total, count(*) filter (where fresh)::int as fresh,
         max(created_at) as last_at
  from public.ai_verdicts group by paper_id
), s as (
  select p.*,
         coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
         coalesce(r.abstain, 0) as reader_abstain,
         coalesce(a.fresh, 0) as ai_fresh, coalesce(a.total, 0) as ai_total,
         -- The AI alone only vouches: its share maps into 50..100%; only readers can rate a paper below 50%.
         case when a.total > 0 then 0.5 + 0.5 * a.fresh::float8 / a.total else 0.5 end as prior,
         coalesce(r.total_w, 0)::float8 as total_w,
         coalesce(r.fresh_w, 0)::float8 as fresh_w,
         coalesce(r.coi, 0) as reader_coi,
         pc.bridged, pc.raters,
         greatest(r.last_at, a.last_at, p.created_at) as last_activity
  from public.papers p
  left join r on r.paper_id = p.id
  left join a on a.paper_id = p.id
  left join public.paper_consensus pc on pc.paper_id = p.id
), t as (
  select s.*,
         case when raters >= 8 then bridged
              when total_w > 0 then fresh_w / total_w
              else prior end as reader_share
  from s
)
select
  id, title, authors, year, venue, url, orgs, tags, area, paper_type, published_on,
  reader_fresh, reader_total, reader_abstain, ai_fresh, ai_total,
  case when reader_total = 0 and ai_total = 0 then null
       else 0.1 * prior + 0.9 * (reader_share * total_w + 5 * prior) / (total_w + 5)
  end as score,
  last_activity,
  cited_by_count,
  reader_coi,
  round(total_w::numeric, 2)::float8 as reader_weight,
  (raters >= 8) as consensus,
  tldr,
  panel_consensus,
  thumbnail,
  hf_upvotes,
  github_url,
  github_stars,
  (select count(*) from public.comments c where c.paper_id = t.id)::int as comments
from t;

grant select on public.paper_scores to anon, authenticated;


-- ===== Curve (view from migrations/008_curve_and_threads.sql) =====

create or replace view public.paper_scores as
with r as (
  select ra.paper_id,
         count(ra.worth_reading) filter (where c.user_id is null)::int                 as total,
         count(*) filter (where ra.worth_reading and c.user_id is null)::int           as fresh,
         count(*) filter (where ra.worth_reading is null)::int                         as abstain,
         count(*) filter (where ra.worth_reading is not null and c.user_id is not null)::int as coi,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading is not null and c.user_id is null), 0) as total_w,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading and c.user_id is null), 0)             as fresh_w,
         max(ra.updated_at) as last_at
  from public.ratings ra
  left join public.vote_coi c on c.user_id = ra.user_id and c.paper_id = ra.paper_id
  left join public.reader_profiles w on w.user_id = ra.user_id
  group by ra.paper_id
), a0 as (
  select paper_id, count(*)::int as total, count(*) filter (where fresh)::int as fresh,
         max(created_at) as last_at
  from public.ai_verdicts group by paper_id
), a as (
  -- Rank among all judged papers: Jev rarely says no, so raw shares bunch up high.
  select a0.*, percent_rank() over (order by a0.fresh::float8 / a0.total) as pr from a0
), s as (
  select p.*,
         coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
         coalesce(r.abstain, 0) as reader_abstain,
         coalesce(a.fresh, 0) as ai_fresh, coalesce(a.total, 0) as ai_total,
         -- AI-only scores are graded on a curve: rank 0..1 maps to 40..90%, so the top fifth reads
         -- "Must read" and the bottom fifth "Mixed reviews". Readers move it from there.
         case when a.total > 0 then 0.4 + 0.5 * a.pr else 0.5 end as prior,
         coalesce(r.total_w, 0)::float8 as total_w,
         coalesce(r.fresh_w, 0)::float8 as fresh_w,
         coalesce(r.coi, 0) as reader_coi,
         pc.bridged, pc.raters,
         greatest(r.last_at, a.last_at, p.created_at) as last_activity
  from public.papers p
  left join r on r.paper_id = p.id
  left join a on a.paper_id = p.id
  left join public.paper_consensus pc on pc.paper_id = p.id
), t as (
  select s.*,
         case when raters >= 8 then bridged
              when total_w > 0 then fresh_w / total_w
              else prior end as reader_share
  from s
)
select
  id, title, authors, year, venue, url, orgs, tags, area, paper_type, published_on,
  reader_fresh, reader_total, reader_abstain, ai_fresh, ai_total,
  case when reader_total = 0 and ai_total = 0 then null
       else 0.1 * prior + 0.9 * (reader_share * total_w + 5 * prior) / (total_w + 5)
  end as score,
  last_activity,
  cited_by_count,
  reader_coi,
  round(total_w::numeric, 2)::float8 as reader_weight,
  (raters >= 8) as consensus,
  tldr,
  panel_consensus,
  thumbnail,
  hf_upvotes,
  github_url,
  github_stars,
  (select count(*) from public.comments c where c.paper_id = t.id)::int as comments
from t;

grant select on public.paper_scores to anon, authenticated;

-- 009_softer_curve
create or replace view public.paper_scores as
with r as (
  select ra.paper_id,
         count(ra.worth_reading) filter (where c.user_id is null)::int                 as total,
         count(*) filter (where ra.worth_reading and c.user_id is null)::int           as fresh,
         count(*) filter (where ra.worth_reading is null)::int                         as abstain,
         count(*) filter (where ra.worth_reading is not null and c.user_id is not null)::int as coi,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading is not null and c.user_id is null), 0) as total_w,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading and c.user_id is null), 0)             as fresh_w,
         max(ra.updated_at) as last_at
  from public.ratings ra
  left join public.vote_coi c on c.user_id = ra.user_id and c.paper_id = ra.paper_id
  left join public.reader_profiles w on w.user_id = ra.user_id
  group by ra.paper_id
), a0 as (
  select paper_id, count(*)::int as total, count(*) filter (where fresh)::int as fresh,
         max(created_at) as last_at
  from public.ai_verdicts group by paper_id
), a as (
  -- Rank among all judged papers: Jev rarely says no, so raw shares bunch up high.
  select a0.*, percent_rank() over (order by a0.fresh::float8 / a0.total) as pr from a0
), s as (
  select p.*,
         coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
         coalesce(r.abstain, 0) as reader_abstain,
         coalesce(a.fresh, 0) as ai_fresh, coalesce(a.total, 0) as ai_total,
         -- AI-only scores are graded on a curve: rank 0..1 maps to 45..92%, so roughly the top quarter reads
         -- "Must read" and the bottom tenth "Niche pick". Readers move it from there.
         case when a.total > 0 then 0.45 + 0.47 * a.pr else 0.5 end as prior,
         coalesce(r.total_w, 0)::float8 as total_w,
         coalesce(r.fresh_w, 0)::float8 as fresh_w,
         coalesce(r.coi, 0) as reader_coi,
         pc.bridged, pc.raters,
         greatest(r.last_at, a.last_at, p.created_at) as last_activity
  from public.papers p
  left join r on r.paper_id = p.id
  left join a on a.paper_id = p.id
  left join public.paper_consensus pc on pc.paper_id = p.id
), t as (
  select s.*,
         case when raters >= 8 then bridged
              when total_w > 0 then fresh_w / total_w
              else prior end as reader_share
  from s
)
select
  id, title, authors, year, venue, url, orgs, tags, area, paper_type, published_on,
  reader_fresh, reader_total, reader_abstain, ai_fresh, ai_total,
  case when reader_total = 0 and ai_total = 0 then null
       else 0.1 * prior + 0.9 * (reader_share * total_w + 5 * prior) / (total_w + 5)
  end as score,
  last_activity,
  cited_by_count,
  reader_coi,
  round(total_w::numeric, 2)::float8 as reader_weight,
  (raters >= 8) as consensus,
  tldr,
  panel_consensus,
  thumbnail,
  hf_upvotes,
  github_url,
  github_stars,
  (select count(*) from public.comments c where c.paper_id = t.id)::int as comments
from t;

grant select on public.paper_scores to anon, authenticated;

-- 010_researchers
create table if not exists public.paper_authors (
  paper_id   text not null references public.papers(id) on delete cascade,
  author_id  text not null,           -- OpenAlex author id, e.g. "A5003442464"
  position   int  not null,           -- 0 = first author
  n_authors  int  not null,
  institution text,                   -- their affiliation on this paper
  primary key (paper_id, author_id)
);
create index if not exists paper_authors_author on public.paper_authors(author_id);

create table if not exists public.researchers (
  id                  text primary key, -- OpenAlex author id
  name                text not null,
  institution         text,             -- OpenAlex's last known; the page prefers paper affiliations
  works_count         int,
  cited_by_count      int,
  h_index             int,
  two_yr_citedness    float8,           -- mean citations of their last two years' papers
  updated_at          timestamptz not null default now()
);

-- When the worker last asked OpenAlex for a paper's authors ("arxiv-" papers wait for indexing).
alter table public.papers add column if not exists authors_checked_at timestamptz;

alter table public.paper_authors enable row level security;
alter table public.researchers enable row level security;
create policy "paper authors are public" on public.paper_authors for select to anon, authenticated using (true);
create policy "researchers are public" on public.researchers for select to anon, authenticated using (true);

-- One row per (author, rated in-scope paper), for the ranking page to aggregate.
create or replace view public.researcher_papers as
select pa.author_id, pa.position, pa.n_authors, pa.institution,
       s.id as paper_id, s.title, s.area, s.score, s.published_on
from public.paper_authors pa
join public.paper_scores s on s.id = pa.paper_id
where s.score is not null and s.area is not null;

grant select on public.researcher_papers to anon, authenticated;

-- 011_conferences
alter table public.papers add column if not exists conf_track text
  check (conf_track in ('oral', 'spotlight', 'poster'));
alter table public.papers add column if not exists conf_sessions jsonb; -- [{name, start, end, room}]
alter table public.papers add column if not exists openreview_url text;
alter table public.papers add column if not exists discuss_on_demand boolean not null default false;
alter table public.papers add column if not exists discuss_requested_at timestamptz;
create index if not exists papers_venue on public.papers(venue);

create or replace view public.paper_scores as
with r as (
  select ra.paper_id,
         count(ra.worth_reading) filter (where c.user_id is null)::int                 as total,
         count(*) filter (where ra.worth_reading and c.user_id is null)::int           as fresh,
         count(*) filter (where ra.worth_reading is null)::int                         as abstain,
         count(*) filter (where ra.worth_reading is not null and c.user_id is not null)::int as coi,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading is not null and c.user_id is null), 0) as total_w,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading and c.user_id is null), 0)             as fresh_w,
         max(ra.updated_at) as last_at
  from public.ratings ra
  left join public.vote_coi c on c.user_id = ra.user_id and c.paper_id = ra.paper_id
  left join public.reader_profiles w on w.user_id = ra.user_id
  group by ra.paper_id
), a0 as (
  select paper_id, count(*)::int as total, count(*) filter (where fresh)::int as fresh,
         max(created_at) as last_at
  from public.ai_verdicts group by paper_id
), a as (
  -- Rank among all judged papers: Jev rarely says no, so raw shares bunch up high.
  select a0.*, percent_rank() over (order by a0.fresh::float8 / a0.total) as pr from a0
), s as (
  select p.*,
         coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
         coalesce(r.abstain, 0) as reader_abstain,
         coalesce(a.fresh, 0) as ai_fresh, coalesce(a.total, 0) as ai_total,
         -- AI-only scores are graded on a curve: rank 0..1 maps to 45..92%, so roughly the top quarter reads
         -- "Must read" and the bottom tenth "Niche pick". Readers move it from there.
         case when a.total > 0 then 0.45 + 0.47 * a.pr
              -- Conference papers the panel can't read yet (no abstract): a starting point from the track.
              when p.conf_track = 'oral' then 0.75
              when p.conf_track = 'spotlight' then 0.68
              when p.conf_track = 'poster' then 0.6
              else 0.5 end as prior,
         coalesce(r.total_w, 0)::float8 as total_w,
         coalesce(r.fresh_w, 0)::float8 as fresh_w,
         coalesce(r.coi, 0) as reader_coi,
         pc.bridged, pc.raters,
         greatest(r.last_at, a.last_at, p.created_at) as last_activity
  from public.papers p
  left join r on r.paper_id = p.id
  left join a on a.paper_id = p.id
  left join public.paper_consensus pc on pc.paper_id = p.id
), t as (
  select s.*,
         case when raters >= 8 then bridged
              when total_w > 0 then fresh_w / total_w
              else prior end as reader_share
  from s
)
select
  id, title, authors, year, venue, url, orgs, tags, area, paper_type, published_on,
  reader_fresh, reader_total, reader_abstain, ai_fresh, ai_total,
  case when reader_total = 0 and ai_total = 0 and conf_track is null then null
       else 0.1 * prior + 0.9 * (reader_share * total_w + 5 * prior) / (total_w + 5)
  end as score,
  last_activity,
  cited_by_count,
  reader_coi,
  round(total_w::numeric, 2)::float8 as reader_weight,
  (raters >= 8) as consensus,
  tldr,
  panel_consensus,
  thumbnail,
  hf_upvotes,
  github_url,
  github_stars,
  (select count(*) from public.comments c where c.paper_id = t.id)::int as comments,
  conf_track,
  conf_sessions,
  openreview_url
from t;

grant select on public.paper_scores to anon, authenticated;

-- One row per (paper, session), ranked by score within the session.
create or replace view public.conf_session_papers as
select s.id, s.title, s.authors, s.orgs, s.area, s.score, s.thumbnail, s.tldr, s.venue, s.conf_track,
       ses->>'name' as session, (ses->>'start')::timestamptz as starts_at,
       (ses->>'end')::timestamptz as ends_at, ses->>'room' as room,
       row_number() over (partition by s.venue, ses->>'name' order by s.score desc nulls last, s.id) as rank
from public.paper_scores s, jsonb_array_elements(s.conf_sessions) ses
where s.conf_sessions is not null;

grant select on public.conf_session_papers to anon, authenticated;

-- Replies to the signed-in reader's comments, newest first, for the notification bell.
create or replace view public.my_replies with (security_invoker = true) as
select c.id, c.paper_id, c.author_kind, c.author_name, c.body, c.created_at, p.title as paper_title
from public.comments c
join public.comments mine on mine.id = c.parent_id
join public.papers p on p.id = c.paper_id
where mine.user_id = auth.uid() and c.user_id is distinct from auth.uid();

grant select on public.my_replies to authenticated;

-- 012_ai_curve, 021_cohort_curve
create materialized view if not exists public.ai_curve as
select a0.paper_id, a0.total, a0.fresh, a0.last_at,
       -- Rank within comparable papers (conference imports, the last 90 days, older):
       -- Jev rarely says no, so raw shares bunch up high.
       percent_rank() over (partition by a0.cohort order by a0.fresh::float8 / a0.total) as pr
from (
  select v.paper_id, count(*)::int as total, count(*) filter (where v.fresh)::int as fresh,
         max(v.created_at) as last_at,
         case when p.conf_track is not null then 'conf'
              when p.published_on >= current_date - 90 then 'recent'
              else 'older' end as cohort
  from public.ai_verdicts v
  join public.papers p on p.id = v.paper_id
  group by v.paper_id, p.conf_track, p.published_on
) a0;
create unique index if not exists ai_curve_paper on public.ai_curve(paper_id);

create or replace function public.refresh_ai_curve() returns void
language sql security definer set search_path = public as $$
  refresh materialized view concurrently public.ai_curve;
$$;
revoke all on function public.refresh_ai_curve() from public, anon, authenticated;
grant execute on function public.refresh_ai_curve() to service_role;

create or replace view public.paper_scores as
with r as (
  select ra.paper_id,
         count(ra.worth_reading) filter (where c.user_id is null)::int                 as total,
         count(*) filter (where ra.worth_reading and c.user_id is null)::int           as fresh,
         count(*) filter (where ra.worth_reading is null)::int                         as abstain,
         count(*) filter (where ra.worth_reading is not null and c.user_id is not null)::int as coi,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading is not null and c.user_id is null), 0) as total_w,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading and c.user_id is null), 0)             as fresh_w,
         max(ra.updated_at) as last_at
  from public.ratings ra
  left join public.vote_coi c on c.user_id = ra.user_id and c.paper_id = ra.paper_id
  left join public.reader_profiles w on w.user_id = ra.user_id
  group by ra.paper_id
), a as (
  -- The AI panel's tallies and curve rank, precomputed in ai_curve (refreshed after judging).
  select * from public.ai_curve
), s as (
  select p.*,
         coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
         coalesce(r.abstain, 0) as reader_abstain,
         coalesce(a.fresh, 0) as ai_fresh, coalesce(a.total, 0) as ai_total,
         -- AI-only scores are graded on a curve: rank 0..1 maps to 45..92%, so roughly the top quarter reads
         -- "Must read" and the bottom tenth "Niche pick". Readers move it from there.
         case when a.total > 0 then 0.45 + 0.47 * a.pr
              -- Conference papers the panel can't read yet (no abstract): a starting point from the track.
              when p.conf_track = 'oral' then 0.75
              when p.conf_track = 'spotlight' then 0.68
              when p.conf_track = 'poster' then 0.6
              else 0.5 end as prior,
         coalesce(r.total_w, 0)::float8 as total_w,
         coalesce(r.fresh_w, 0)::float8 as fresh_w,
         coalesce(r.coi, 0) as reader_coi,
         pc.bridged, pc.raters,
         greatest(r.last_at, a.last_at, p.created_at) as last_activity
  from public.papers p
  left join r on r.paper_id = p.id
  left join a on a.paper_id = p.id
  left join public.paper_consensus pc on pc.paper_id = p.id
), t as (
  select s.*,
         case when raters >= 8 then bridged
              when total_w > 0 then fresh_w / total_w
              else prior end as reader_share
  from s
)
select
  id, title, authors, year, venue, url, orgs, tags, area, paper_type, published_on,
  reader_fresh, reader_total, reader_abstain, ai_fresh, ai_total,
  case when reader_total = 0 and ai_total = 0 and conf_track is null then null
       else 0.1 * prior + 0.9 * (reader_share * total_w + 5 * prior) / (total_w + 5)
  end as score,
  last_activity,
  cited_by_count,
  reader_coi,
  round(total_w::numeric, 2)::float8 as reader_weight,
  (raters >= 8) as consensus,
  tldr,
  panel_consensus,
  thumbnail,
  hf_upvotes,
  github_url,
  github_stars,
  (select count(*) from public.comments c where c.paper_id = t.id)::int as comments,
  conf_track,
  conf_sessions,
  openreview_url
from t;

grant select on public.paper_scores to anon, authenticated;

-- 013_comment_counts
create or replace view public.paper_scores as
with r as (
  select ra.paper_id,
         count(ra.worth_reading) filter (where c.user_id is null)::int                 as total,
         count(*) filter (where ra.worth_reading and c.user_id is null)::int           as fresh,
         count(*) filter (where ra.worth_reading is null)::int                         as abstain,
         count(*) filter (where ra.worth_reading is not null and c.user_id is not null)::int as coi,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading is not null and c.user_id is null), 0) as total_w,
         coalesce(sum(coalesce(w.weight, 0.5)) filter (where ra.worth_reading and c.user_id is null), 0)             as fresh_w,
         max(ra.updated_at) as last_at
  from public.ratings ra
  left join public.vote_coi c on c.user_id = ra.user_id and c.paper_id = ra.paper_id
  left join public.reader_profiles w on w.user_id = ra.user_id
  group by ra.paper_id
), a as (
  -- The AI panel's tallies and curve rank, precomputed in ai_curve (refreshed after judging).
  select * from public.ai_curve
), cc as (
  select paper_id, count(*)::int as n from public.comments group by paper_id
), s as (
  select p.*,
         coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
         coalesce(r.abstain, 0) as reader_abstain,
         coalesce(a.fresh, 0) as ai_fresh, coalesce(a.total, 0) as ai_total,
         -- AI-only scores are graded on a curve: rank 0..1 maps to 45..92%, so roughly the top quarter reads
         -- "Must read" and the bottom tenth "Niche pick". Readers move it from there.
         case when a.total > 0 then 0.45 + 0.47 * a.pr
              -- Conference papers the panel can't read yet (no abstract): a starting point from the track.
              when p.conf_track = 'oral' then 0.75
              when p.conf_track = 'spotlight' then 0.68
              when p.conf_track = 'poster' then 0.6
              else 0.5 end as prior,
         coalesce(r.total_w, 0)::float8 as total_w,
         coalesce(r.fresh_w, 0)::float8 as fresh_w,
         coalesce(r.coi, 0) as reader_coi,
         pc.bridged, pc.raters,
         greatest(r.last_at, a.last_at, p.created_at) as last_activity,
         coalesce(cc.n, 0) as comment_count
  from public.papers p
  left join r on r.paper_id = p.id
  left join a on a.paper_id = p.id
  left join public.paper_consensus pc on pc.paper_id = p.id
  left join cc on cc.paper_id = p.id
), t as (
  select s.*,
         case when raters >= 8 then bridged
              when total_w > 0 then fresh_w / total_w
              else prior end as reader_share
  from s
)
select
  id, title, authors, year, venue, url, orgs, tags, area, paper_type, published_on,
  reader_fresh, reader_total, reader_abstain, ai_fresh, ai_total,
  case when reader_total = 0 and ai_total = 0 and conf_track is null then null
       else 0.1 * prior + 0.9 * (reader_share * total_w + 5 * prior) / (total_w + 5)
  end as score,
  last_activity,
  cited_by_count,
  reader_coi,
  round(total_w::numeric, 2)::float8 as reader_weight,
  (raters >= 8) as consensus,
  tldr,
  panel_consensus,
  thumbnail,
  hf_upvotes,
  github_url,
  github_stars,
  comment_count as comments,
  conf_track,
  conf_sessions,
  openreview_url
from t;

grant select on public.paper_scores to anon, authenticated;

-- 014_personalization
create table if not exists public.reader_prefs (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  areas        text[] not null default '{}',   -- area keys and area-group keys (lib/areas.ts)
  venues       text[] not null default '{}',   -- e.g. {NeurIPS, ICLR}
  name         text,
  institution  text,
  onboarded_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.reader_prefs enable row level security;
drop policy if exists "read own prefs" on public.reader_prefs;
drop policy if exists "write own prefs" on public.reader_prefs;
drop policy if exists "update own prefs" on public.reader_prefs;
create policy "read own prefs" on public.reader_prefs for select to authenticated using (user_id = auth.uid());
create policy "write own prefs" on public.reader_prefs for insert to authenticated with check (user_id = auth.uid());
create policy "update own prefs" on public.reader_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace view public.paper_scores as
with r as (
  -- Votes with a conflict of interest (your own or a colleague's paper) still count, at 30% weight.
  select ra.paper_id,
         count(ra.worth_reading)::int                                                  as total,
         count(*) filter (where ra.worth_reading)::int                                 as fresh,
         count(*) filter (where ra.worth_reading is null)::int                         as abstain,
         count(*) filter (where ra.worth_reading is not null and c.user_id is not null)::int as coi,
         coalesce(sum(coalesce(w.weight, 0.5) * case when c.user_id is null then 1 else 0.3 end)
                  filter (where ra.worth_reading is not null), 0) as total_w,
         coalesce(sum(coalesce(w.weight, 0.5) * case when c.user_id is null then 1 else 0.3 end)
                  filter (where ra.worth_reading), 0)             as fresh_w,
         max(ra.updated_at) as last_at
  from public.ratings ra
  left join public.vote_coi c on c.user_id = ra.user_id and c.paper_id = ra.paper_id
  left join public.reader_profiles w on w.user_id = ra.user_id
  group by ra.paper_id
), a as (
  -- The AI panel's tallies and curve rank, precomputed in ai_curve (refreshed after judging).
  select * from public.ai_curve
), cc as (
  select paper_id, count(*)::int as n from public.comments group by paper_id
), s as (
  select p.*,
         coalesce(r.fresh, 0) as reader_fresh, coalesce(r.total, 0) as reader_total,
         coalesce(r.abstain, 0) as reader_abstain,
         coalesce(a.fresh, 0) as ai_fresh, coalesce(a.total, 0) as ai_total,
         -- AI-only scores are graded on a curve: rank 0..1 maps to 45..92%, so roughly the top quarter reads
         -- "Must read" and the bottom tenth "Niche pick". Readers move it from there.
         case when a.total > 0 then 0.45 + 0.47 * a.pr
              -- Conference papers the panel can't read yet (no abstract): a starting point from the track.
              when p.conf_track = 'oral' then 0.75
              when p.conf_track = 'spotlight' then 0.68
              when p.conf_track = 'poster' then 0.6
              else 0.5 end as prior,
         coalesce(r.total_w, 0)::float8 as total_w,
         coalesce(r.fresh_w, 0)::float8 as fresh_w,
         coalesce(r.coi, 0) as reader_coi,
         pc.bridged, pc.raters,
         greatest(r.last_at, a.last_at, p.created_at) as last_activity,
         coalesce(cc.n, 0) as comment_count
  from public.papers p
  left join r on r.paper_id = p.id
  left join a on a.paper_id = p.id
  left join public.paper_consensus pc on pc.paper_id = p.id
  left join cc on cc.paper_id = p.id
), t as (
  select s.*,
         case when raters >= 8 then bridged
              when total_w > 0 then fresh_w / total_w
              else prior end as reader_share
  from s
)
select
  id, title, authors, year, venue, url, orgs, tags, area, paper_type, published_on,
  reader_fresh, reader_total, reader_abstain, ai_fresh, ai_total,
  case when reader_total = 0 and ai_total = 0 and conf_track is null then null
       else 0.1 * prior + 0.9 * (reader_share * total_w + 5 * prior) / (total_w + 5)
  end as score,
  last_activity,
  cited_by_count,
  reader_coi,
  round(total_w::numeric, 2)::float8 as reader_weight,
  (raters >= 8) as consensus,
  tldr,
  panel_consensus,
  thumbnail,
  hf_upvotes,
  github_url,
  github_stars,
  comment_count as comments,
  conf_track,
  conf_sessions,
  openreview_url
from t;

grant select on public.paper_scores to anon, authenticated;

-- 015_reading_history
create table if not exists public.reader_views (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paper_id text not null references public.papers(id) on delete cascade,
  day      date not null default current_date,
  seconds  int  not null default 0,
  primary key (user_id, paper_id, day)
);
create index if not exists reader_views_recent on public.reader_views(user_id, day desc);

alter table public.reader_views enable row level security;
drop policy if exists "read own views" on public.reader_views;
drop policy if exists "clear own views" on public.reader_views;
create policy "read own views" on public.reader_views for select to authenticated using (user_id = auth.uid());
create policy "clear own views" on public.reader_views for delete to authenticated using (user_id = auth.uid());

-- Adds reading time to today's row (at most 60 s per call, 2 hours per paper per day).
create or replace function public.bump_view(p_paper text, p_seconds int)
returns void language sql security definer set search_path = public as $$
  insert into public.reader_views (user_id, paper_id, day, seconds)
  select auth.uid(), p_paper, current_date, least(greatest(p_seconds, 0), 60)
  where auth.uid() is not null and exists (select 1 from public.papers where id = p_paper)
  on conflict (user_id, paper_id, day)
  do update set seconds = least(public.reader_views.seconds + excluded.seconds, 7200);
$$;
revoke all on function public.bump_view(text, int) from public, anon;
grant execute on function public.bump_view(text, int) to authenticated;

-- 016_agents

create table if not exists public.agents (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  handle      text not null unique check (handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  name        text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 280),
  owner_name  text,                          -- shown as "run by ..."
  key_hash    text not null unique,          -- sha256 of the API key; the key itself is shown once
  key_prefix  text not null,                 -- first characters, so owners can tell keys apart
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index if not exists agents_owner on public.agents(owner_id);

alter table public.agents enable row level security;
drop policy if exists "owners read their agents" on public.agents;
drop policy if exists "owners revoke their agents" on public.agents;
create policy "owners read their agents" on public.agents for select to authenticated using (owner_id = auth.uid());
create policy "owners revoke their agents" on public.agents for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- Agents are created by /api/agents with the service role (it generates the key).

-- Comments by agents.
alter table public.comments add column if not exists agent_id uuid references public.agents(id) on delete cascade;
alter table public.comments drop constraint if exists comments_author_kind_check;
alter table public.comments add constraint comments_author_kind_check check (author_kind in ('user', 'ai', 'agent'));
alter table public.comments drop constraint if exists comments_agent_check;
alter table public.comments add constraint comments_agent_check check ((author_kind = 'agent') = (agent_id is not null));
create index if not exists comments_agent_idx on public.comments (agent_id, created_at) where agent_id is not null;

-- The feed shows who runs each agent.
create or replace view public.comment_feed as
select c.id, c.paper_id, c.parent_id, c.author_kind, c.user_id, c.author_name, c.persona,
       c.body, c.stance, c.quote_score, c.created_at,
       (select count(*) from public.comment_likes l where l.comment_id = c.id)::int as likes,
       (select count(*) from public.comments r where r.parent_id = c.id)::int as replies,
       c.agent_id,
       a.owner_name as agent_owner
from public.comments c
left join public.agents a on a.id = c.agent_id;
grant select on public.comment_feed to anon, authenticated;

-- Paper embeddings for "For you": SPECTER2 vectors (768 dims, title + abstract), computed by
-- the embed workflow (worker/embed.py). A reader's interest is the weighted average of the
-- papers they voted on, commented on and read; For you adds the papers closest to it.
-- Safe to run once after 016.

create extension if not exists vector with schema extensions;

alter table public.papers add column if not exists embedding extensions.vector(768);
-- No index yet: an exact scan over ~10k papers takes milliseconds, and an approximate
-- index would drop matches once the date filter applies. Add HNSW past ~100k papers.

-- Papers closest to a weighted set of papers (p_ids, p_weights), published on or after
-- p_since (or undated, e.g. conference papers), excluding the given papers themselves.
-- For each match it also names the given paper it is closest to, for "Like ...".
create or replace function public.similar_papers(p_ids text[], p_weights float8[], p_since date, p_limit int default 60)
returns table (id text, similarity float8, like_id text, like_title text)
language sql stable set search_path = public, extensions as $$
  with src as (
    select p.id, p.title, p.embedding, w.weight
    from unnest(p_ids, p_weights) as w(pid, weight)
    join papers p on p.id = w.pid
    where p.embedding is not null and w.weight > 0
  ),
  center as (  -- the weighted sum of their vectors
    select array_agg(t.s order by t.i)::vector(768) as v
    from (
      select u.i, sum(u.e * src.weight) as s
      from src, unnest(src.embedding::real[]) with ordinality as u(e, i)
      group by u.i
    ) t
  ),
  near as (
    select p.id, p.embedding, 1 - (p.embedding <=> c.v) as similarity
    from papers p, center c
    where c.v is not null and p.embedding is not null and p.area is not null
      and (p.published_on is null or p.published_on >= p_since)
      and not (p.id = any (p_ids))
    order by p.embedding <=> c.v
    limit least(greatest(p_limit, 1), 200)
  )
  select n.id, n.similarity, l.id, l.title
  from near n
  cross join lateral (select src.id, src.title from src order by src.embedding <=> n.embedding limit 1) l
  order by n.similarity desc;
$$;
grant execute on function public.similar_papers(text[], float8[], date, int) to anon, authenticated;

-- Bulk write for the embed workflow (service role only): [{"id": "...", "embedding": [...]}].
create or replace function public.set_paper_embeddings(rows jsonb)
returns int language sql security definer set search_path = public, extensions as $$
  with r as (
    select x->>'id' as id, (x->>'embedding')::vector(768) as embedding from jsonb_array_elements(rows) x
  ), u as (
    update papers p set embedding = r.embedding from r where p.id = r.id returning 1
  )
  select count(*)::int from u;
$$;
revoke all on function public.set_paper_embeddings(jsonb) from public, anon, authenticated;

-- Nearest neighbours, computed offline by worker/neighbors.py after each embed run, so
-- "For you" reads a small table instead of scanning every vector (cold scans took seconds).
-- source: a paper id, or "area:<key>" for the centroid of a topic's papers.
-- Neighbours are papers with an area published in the last 180 days, or undated ones.
-- Safe to run once after 017.

create table if not exists public.paper_neighbors (
  source      text not null,
  rank        smallint not null,
  neighbor_id text not null references public.papers(id) on delete cascade,
  similarity  real not null,
  primary key (source, rank)
);
create table if not exists public.paper_neighbors_next (like public.paper_neighbors including all);
alter table public.paper_neighbors_next drop constraint if exists paper_neighbors_next_pkey;

alter table public.paper_neighbors enable row level security;
alter table public.paper_neighbors_next enable row level security;
drop policy if exists "anyone reads neighbours" on public.paper_neighbors;
create policy "anyone reads neighbours" on public.paper_neighbors for select to anon, authenticated using (true);

-- The worker fills paper_neighbors_next in batches, then swaps it in at once.
create or replace function public.stage_paper_neighbors(rows jsonb, reset boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if reset then delete from paper_neighbors_next where true; end if;
  insert into paper_neighbors_next (source, rank, neighbor_id, similarity)
  select x->>'s', (x->>'r')::smallint, x->>'n', (x->>'v')::real
  from jsonb_array_elements(rows) x
  where exists (select 1 from papers p where p.id = x->>'n');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.publish_paper_neighbors()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from paper_neighbors_next;
  if n = 0 then return 0; end if;
  delete from paper_neighbors where true;
  insert into paper_neighbors select distinct on (source, rank) * from paper_neighbors_next;
  delete from paper_neighbors_next where true;
  return n;
end $$;
revoke all on function public.stage_paper_neighbors(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.publish_paper_neighbors() from public, anon, authenticated;

-- Nearest neighbours, one row per source: the paper ids and similarities as arrays, so a
-- full refresh is a few thousand small upserts instead of rewriting one row per neighbour
-- (which outgrew the statement timeout). worker/neighbors.py upserts every source, then
-- deletes the ones it didn't touch. Replaces the tables and functions from 018.
-- Safe to run once after 018.

drop function if exists public.stage_paper_neighbors(jsonb, boolean);
drop function if exists public.publish_paper_neighbors();
drop table if exists public.paper_neighbors_next;
drop table if exists public.paper_neighbors;

create table public.paper_neighbors (
  source       text primary key,          -- a paper id, or "area:<key>" for a topic
  neighbor_ids text[] not null,           -- closest first
  similarities real[] not null,
  updated_at   timestamptz not null default now()
);
alter table public.paper_neighbors enable row level security;
create policy "anyone reads neighbours" on public.paper_neighbors for select to anon, authenticated using (true);
-- Database load (Oct 2026: CPU at 90%, Disk IO budget running out). Safe to run once after 019.

-- 1. Is this arXiv paper stored already? storedIdsByArxiv (lib/papers.ts) matches
--    url ilike '%2610.12345%', which scanned every paper (~0.35 s, thousands of times a day).
--    A trigram index serves those substring matches.
create extension if not exists pg_trgm with schema extensions;
create index if not exists papers_url_trgm on public.papers using gin (url extensions.gin_trgm_ops);

-- 2. The AI curve is recomputed from every verdict (~2 s). Background jobs pass a minimum age
--    so a burst of judging refreshes it once; the paper page passes 0 and refreshes at once.
create table if not exists public.app_state (
  key   text primary key,
  at    timestamptz not null default now()
);
alter table public.app_state enable row level security;  -- service role only

drop function if exists public.refresh_ai_curve();
create or replace function public.refresh_ai_curve(p_min_age_minutes int default 0) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_min_age_minutes > 0 and exists (
    select 1 from app_state where key = 'ai_curve' and at > now() - make_interval(mins => p_min_age_minutes)
  ) then
    return false;
  end if;
  refresh materialized view concurrently ai_curve;
  insert into app_state (key, at) values ('ai_curve', now())
    on conflict (key) do update set at = excluded.at;
  return true;
end $$;
revoke all on function public.refresh_ai_curve(int) from public, anon, authenticated;
grant execute on function public.refresh_ai_curve(int) to service_role;

-- 3. Waking the worker: the site dispatched it on every first open of a NeurIPS paper, and a
--    crawler opening thousands of them meant a dispatch every ~30 s. claim_slot lets one
--    caller through per interval; the worker picks up everything requested in the meantime.
create or replace function public.claim_slot(p_key text, p_min_seconds int) returns boolean
language sql security definer set search_path = public as $$
  insert into app_state (key, at) values (p_key, now())
  on conflict (key) do update set at = excluded.at
    where app_state.at < now() - make_interval(secs => p_min_seconds)
  returning true;
$$;
revoke all on function public.claim_slot(text, int) from public, anon, authenticated;
grant execute on function public.claim_slot(text, int) to service_role;

-- 022_paper_claims

create table if not exists public.orcid_accounts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  orcid       text not null unique,          -- e.g. 0000-0002-1825-0097
  name        text,                          -- as on the ORCID record
  openalex_id text,                          -- A..., when OpenAlex knows the ORCID
  verified_at timestamptz not null default now(),
  synced_at   timestamptz not null default now()
);
alter table public.orcid_accounts enable row level security;
drop policy if exists "orcid accounts are public" on public.orcid_accounts;
create policy "orcid accounts are public" on public.orcid_accounts for select to anon, authenticated using (true);
drop policy if exists "readers disconnect their ORCID" on public.orcid_accounts;
create policy "readers disconnect their ORCID" on public.orcid_accounts for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.paper_claims (
  user_id    uuid not null references auth.users(id) on delete cascade,
  paper_id   text not null references public.papers(id) on delete cascade,
  source     text not null default 'orcid' check (source in ('orcid', 'openalex')),
  created_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);
create index if not exists paper_claims_paper on public.paper_claims (paper_id);
alter table public.paper_claims enable row level security;
drop policy if exists "claims are public" on public.paper_claims;
create policy "claims are public" on public.paper_claims for select to anon, authenticated using (true);
drop policy if exists "authors drop their claims" on public.paper_claims;
create policy "authors drop their claims" on public.paper_claims for delete to authenticated using (auth.uid() = user_id);

-- 024_anon_comments_and_matches

-- 1. Anonymous comments. The row keeps its user_id (for deleting it and for moderation), but
--    no one else can read it from the table: the public feed (comment_feed, which runs as its
--    owner) shows it as "anonymous" with the user_id blanked and a `mine` flag for the author.
alter table public.comments add column if not exists anonymous boolean not null default false;

create or replace function public.comments_fill_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_kind = 'user' then
    if new.anonymous then
      new.author_name := 'anonymous';
    else
      select coalesce(raw_user_meta_data->>'user_name', raw_user_meta_data->>'name', 'reader')
        into new.author_name from auth.users where id = new.user_id;
    end if;
    new.needs_reply := true;
  end if;
  return new;
end $$;

drop policy if exists "comments are public" on public.comments;
create policy "comments are public" on public.comments for select to anon, authenticated
  using (not anonymous or user_id = auth.uid());

create or replace view public.comment_feed as
select c.id, c.paper_id, c.parent_id, c.author_kind,
       case when c.anonymous then null else c.user_id end as user_id,
       c.author_name, c.persona,
       c.body, c.stance, c.quote_score, c.created_at,
       (select count(*) from public.comment_likes l where l.comment_id = c.id)::int as likes,
       (select count(*) from public.comments r where r.parent_id = c.id)::int as replies,
       c.agent_id,
       a.owner_name as agent_owner,
       c.anonymous,
       (c.user_id is not null and c.user_id = auth.uid()) as mine
from public.comments c
left join public.agents a on a.id = c.agent_id;
grant select on public.comment_feed to anon, authenticated;

-- Replies to your comments, anonymous ones included (runs as its owner, filtered to you).
create or replace view public.my_replies with (security_invoker = false) as
select c.id, c.paper_id, c.author_kind, c.author_name, c.body, c.created_at, p.title as paper_title
from public.comments c
join public.comments mine on mine.id = c.parent_id
join public.papers p on p.id = c.paper_id
where mine.user_id = auth.uid() and c.user_id is distinct from auth.uid();
grant select on public.my_replies to authenticated;

-- 2. Matches (lib/matches.ts): readers who opted in, with papers claimed through ORCID, who
--    each voted on the other's papers, either way. Directions are never shown.
create table if not exists public.match_optin (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.match_optin enable row level security;
drop policy if exists "own match opt-in" on public.match_optin;
create policy "own match opt-in" on public.match_optin for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 025_match_messages

create table if not exists public.match_messages (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid not null references auth.users(id) on delete cascade,
  recipient  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  check (sender <> recipient)
);
create index if not exists match_messages_inbox on public.match_messages (recipient, created_at desc);
create index if not exists match_messages_pair on public.match_messages (sender, recipient, created_at desc);
alter table public.match_messages enable row level security;
drop policy if exists "read own messages" on public.match_messages;
create policy "read own messages" on public.match_messages for select to authenticated
  using (auth.uid() = sender or auth.uid() = recipient);

-- Blocking someone hides the match and stops messages both ways.
create table if not exists public.match_blocks (
  blocker    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table public.match_blocks enable row level security;
drop policy if exists "own blocks" on public.match_blocks;
create policy "own blocks" on public.match_blocks for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());

-- Reports, for the site owner to look at (service role only reads them).
create table if not exists public.message_reports (
  id         uuid primary key default gen_random_uuid(),
  reporter   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message_id uuid not null references public.match_messages(id) on delete cascade,
  reason     text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
alter table public.message_reports enable row level security;
drop policy if exists "file a report" on public.message_reports;
create policy "file a report" on public.message_reports for insert to authenticated
  with check (reporter = auth.uid() and exists (
    select 1 from public.match_messages m where m.id = message_id and m.recipient = auth.uid()));
