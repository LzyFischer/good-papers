-- NeurIPS 2026 (and later conferences): each accepted paper's track and poster sessions,
-- a view of papers per session ranked by score for the /neurips page, and on-demand AI
-- discussions for bulk-imported papers (the worker only discusses them once someone
-- opens them). Safe to run once after 010.

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
