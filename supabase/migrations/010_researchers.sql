-- Good researchers: who wrote each paper (OpenAlex author ids, so namesakes stay apart)
-- and each author's citation record. The worker fills both; the /researchers page
-- reads them. Safe to run once after 009.

create table if not exists public.paper_authors (
  paper_id   text not null references public.papers(id) on delete cascade,
  author_id  text not null,           -- OpenAlex author id, e.g. "A5003442464"
  position   int  not null,           -- 0 = first author
  n_authors  int  not null,
  institution text,                   -- their affiliation on this paper
  primary key (paper_id, author_id)
);
create index if not exists paper_authors_author on public.paper_authors(author_id);

create table if not exists public.researchers (
  id                  text primary key, -- OpenAlex author id
  name                text not null,
  institution         text,             -- OpenAlex's last known; the page prefers paper affiliations
  works_count         int,
  cited_by_count      int,
  h_index             int,
  two_yr_citedness    float8,           -- mean citations of their last two years' papers
  updated_at          timestamptz not null default now()
);

-- When the worker last asked OpenAlex for a paper's authors ("arxiv-" papers wait for indexing).
alter table public.papers add column if not exists authors_checked_at timestamptz;

alter table public.paper_authors enable row level security;
alter table public.researchers enable row level security;
create policy "paper authors are public" on public.paper_authors for select to anon, authenticated using (true);
create policy "researchers are public" on public.researchers for select to anon, authenticated using (true);

-- One row per (author, rated in-scope paper), for the ranking page to aggregate.
create or replace view public.researcher_papers as
select pa.author_id, pa.position, pa.n_authors, pa.institution,
       s.id as paper_id, s.title, s.area, s.score, s.published_on
from public.paper_authors pa
join public.paper_scores s on s.id = pa.paper_id
where s.score is not null and s.area is not null;

grant select on public.researcher_papers to anon, authenticated;
