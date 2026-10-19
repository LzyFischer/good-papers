-- 022: authors claim their papers, verified through ORCID.
-- A reader connects their ORCID iD (signed in with ORCID, app/api/orcid); we read the works on
-- their ORCID record and OpenAlex profile and claim the ones we have. Only the server writes
-- (service role), so a claim always means "this paper is on the reader's verified record".
-- Readers can drop their own claims. Safe to run once after 021.

create table if not exists public.researchers (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  orcid       text not null unique,          -- e.g. 0000-0002-1825-0097
  name        text,                          -- as on the ORCID record
  openalex_id text,                          -- A..., when OpenAlex knows the ORCID
  verified_at timestamptz not null default now(),
  synced_at   timestamptz not null default now()
);
alter table public.researchers enable row level security;
drop policy if exists "researchers are public" on public.researchers;
create policy "researchers are public" on public.researchers for select to anon, authenticated using (true);
drop policy if exists "readers disconnect their ORCID" on public.researchers;
create policy "readers disconnect their ORCID" on public.researchers for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.paper_claims (
  user_id    uuid not null references auth.users(id) on delete cascade,
  paper_id   text not null references public.papers(id) on delete cascade,
  source     text not null default 'orcid' check (source in ('orcid', 'openalex')),
  created_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);
create index if not exists paper_claims_paper on public.paper_claims (paper_id);
alter table public.paper_claims enable row level security;
drop policy if exists "claims are public" on public.paper_claims;
create policy "claims are public" on public.paper_claims for select to anon, authenticated using (true);
drop policy if exists "authors drop their claims" on public.paper_claims;
create policy "authors drop their claims" on public.paper_claims for delete to authenticated using (auth.uid() = user_id);
