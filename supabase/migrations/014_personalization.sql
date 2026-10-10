-- Personalization and softer conflict-of-interest rules. Safe to run once after 013.
--   reader_prefs: what each reader follows (areas, venues) and who they are (name,
--     affiliation), set on the welcome page after sign-up; private to the reader.
--   paper_scores: votes on your own or a colleague's paper now count at 30% weight
--     instead of not at all.

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
