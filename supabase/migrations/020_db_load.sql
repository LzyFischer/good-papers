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
