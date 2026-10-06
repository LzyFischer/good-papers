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
