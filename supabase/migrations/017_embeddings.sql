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
