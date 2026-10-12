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
