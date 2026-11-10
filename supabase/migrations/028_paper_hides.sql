-- 028: "Not relevant to me" (components/HideButton.tsx on For you cards) and skips in the home
-- hero deck. Separate from ratings: neither touches a paper's score. lib/forYou.ts leaves
-- hidden papers out, pulls their topic and the papers closest to them down (kind 'hide'),
-- and counts a skip as a very weak "not interested" (kind 'skip'). Safe to run once after 027.

create table if not exists public.paper_hides (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paper_id   text not null references public.papers(id) on delete cascade,
  kind       text not null default 'hide' check (kind in ('hide', 'skip')),
  created_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);
alter table public.paper_hides enable row level security;
drop policy if exists "read own hides" on public.paper_hides;
drop policy if exists "add own hides" on public.paper_hides;
drop policy if exists "change own hides" on public.paper_hides;
drop policy if exists "remove own hides" on public.paper_hides;
create policy "read own hides" on public.paper_hides for select to authenticated using (user_id = auth.uid());
create policy "add own hides" on public.paper_hides for insert to authenticated with check (user_id = auth.uid());
create policy "change own hides" on public.paper_hides for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "remove own hides" on public.paper_hides for delete to authenticated using (user_id = auth.uid());
