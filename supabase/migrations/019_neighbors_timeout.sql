-- Swapping in the neighbour table rewrites every row (one per paper and rank), which can take
-- longer than the API's default statement timeout. Safe to run once after 018.
alter function public.stage_paper_neighbors(jsonb, boolean) set statement_timeout = '5min';
alter function public.publish_paper_neighbors() set statement_timeout = '5min';
