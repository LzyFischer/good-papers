-- 023: the ORCID link table from 022 under its own name. 022 called it "researchers", but a
-- table by that name already holds OpenAlex author stats (010), so on production 022 left it
-- alone. Run this once on databases that ran the old 022; fresh installs get it from 022.

drop policy if exists "readers disconnect their ORCID" on public.researchers;

create table if not exists public.orcid_accounts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  orcid       text not null unique,          -- e.g. 0000-0002-1825-0097
  name        text,                          -- as on the ORCID record
  openalex_id text,                          -- A..., when OpenAlex knows the ORCID
  verified_at timestamptz not null default now(),
  synced_at   timestamptz not null default now()
);
alter table public.orcid_accounts enable row level security;
drop policy if exists "orcid accounts are public" on public.orcid_accounts;
create policy "orcid accounts are public" on public.orcid_accounts for select to anon, authenticated using (true);
drop policy if exists "readers disconnect their ORCID" on public.orcid_accounts;
create policy "readers disconnect their ORCID" on public.orcid_accounts for delete to authenticated using (auth.uid() = user_id);

-- paper_claims, in case 022 stopped before it.
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
