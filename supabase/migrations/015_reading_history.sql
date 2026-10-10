-- Reading history for "For you": which papers a signed-in reader opens and how long they
-- stay, one row per reader, paper and day. Private to the reader. Safe to run once after 014.

create table if not exists public.reader_views (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paper_id text not null references public.papers(id) on delete cascade,
  day      date not null default current_date,
  seconds  int  not null default 0,
  primary key (user_id, paper_id, day)
);
create index if not exists reader_views_recent on public.reader_views(user_id, day desc);

alter table public.reader_views enable row level security;
drop policy if exists "read own views" on public.reader_views;
drop policy if exists "clear own views" on public.reader_views;
create policy "read own views" on public.reader_views for select to authenticated using (user_id = auth.uid());
create policy "clear own views" on public.reader_views for delete to authenticated using (user_id = auth.uid());

-- Adds reading time to today's row (at most 60 s per call, 2 hours per paper per day).
create or replace function public.bump_view(p_paper text, p_seconds int)
returns void language sql security definer set search_path = public as $$
  insert into public.reader_views (user_id, paper_id, day, seconds)
  select auth.uid(), p_paper, current_date, least(greatest(p_seconds, 0), 60)
  where auth.uid() is not null and exists (select 1 from public.papers where id = p_paper)
  on conflict (user_id, paper_id, day)
  do update set seconds = least(public.reader_views.seconds + excluded.seconds, 7200);
$$;
revoke all on function public.bump_view(text, int) from public, anon;
grant execute on function public.bump_view(text, int) to authenticated;
