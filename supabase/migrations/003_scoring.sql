-- v3 scoring: two tables (readers, AI panel), abstentions, and a headline
-- score where the AI panel is a 10% weight plus a prior that readers'
-- votes override as they accumulate. See SCORING in lib/types.ts.
-- Safe to run once after 002. Keeps reviewer_scores (unused for now).

-- A reader who has read the paper but gives no verdict: worth_reading is null.
alter table public.ratings alter column worth_reading drop not null;

-- Persona ids changed (5 → 20); old verdicts are replaced when papers are re-judged.

drop view if exists public.paper_scores;
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
