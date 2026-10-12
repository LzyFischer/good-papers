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
