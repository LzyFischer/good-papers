-- Speed: the AI panel's curve (percentile rank of each paper's share of yes votes) was
-- recomputed from all ai_verdicts rows on every paper_scores query, ~130 ms each with
-- 130k verdicts. It now lives in a materialized view the app refreshes after judging.
-- Safe to run once after 011.

create materialized view if not exists public.ai_curve as
select a0.paper_id, a0.total, a0.fresh, a0.last_at,
       -- Rank among all judged papers: Jev rarely says no, so raw shares bunch up high.
       percent_rank() over (order by a0.fresh::float8 / a0.total) as pr
from (
  select paper_id, count(*)::int as total, count(*) filter (where fresh)::int as fresh,
         max(created_at) as last_at
  from public.ai_verdicts group by paper_id
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
