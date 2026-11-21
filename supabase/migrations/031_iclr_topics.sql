-- ICLR standing page: competition by primary area and by author keyword (scripts/iclr_topics.py),
-- kept apart from iclr_stats.data so single-paper views don't load it.
alter table public.iclr_stats add column if not exists topics jsonb;
