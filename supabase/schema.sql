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
