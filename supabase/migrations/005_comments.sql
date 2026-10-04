-- Phase 2: discussion under each paper. Signed-in readers comment and reply;
-- the AI panel (worker/, Inkling-Small on Tinker) seeds discussions and answers
-- readers; Jev labels every comment's stance and how quotable it is, which feeds
-- the hot-quotes board. Safe to run once after 004.

create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  paper_id     text not null references public.papers(id) on delete cascade,
  parent_id    uuid references public.comments(id) on delete cascade, -- one level of replies
  author_kind  text not null default 'user' check (author_kind in ('user', 'ai')),
  user_id      uuid default auth.uid() references auth.users(id) on delete cascade,
  author_name  text,                 -- GitHub login for readers (set by trigger), persona name for AI
  persona      text,                 -- AI persona id (lib/personas.ts)
  body         text not null check (char_length(body) between 1 and 2000),
  stance       text check (stance in ('fresh', 'rotten', 'neutral')), -- set by Jev
  quote_score  real,                 -- Jev: how sharp and quotable, 0..1
  needs_reply  boolean not null default false, -- reader comments waiting for an AI reply
  created_at   timestamptz not null default now(),
  check ((author_kind = 'user') = (user_id is not null))
);
create index if not exists comments_paper_idx on public.comments (paper_id, created_at);
create index if not exists comments_pending_idx on public.comments (created_at) where needs_reply;

create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- Readers can't choose their display name or skip the AI reply queue.
create or replace function public.comments_fill_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_kind = 'user' then
    select coalesce(raw_user_meta_data->>'user_name', raw_user_meta_data->>'name', 'reader')
      into new.author_name from auth.users where id = new.user_id;
    new.needs_reply := true;
  end if;
  return new;
end $$;
drop trigger if exists comments_fill_author on public.comments;
create trigger comments_fill_author before insert on public.comments
  for each row execute function public.comments_fill_author();

alter table public.comments      enable row level security;
alter table public.comment_likes enable row level security;

drop policy if exists "comments are public" on public.comments;
create policy "comments are public" on public.comments for select to anon, authenticated using (true);
drop policy if exists "readers add own comments" on public.comments;
create policy "readers add own comments" on public.comments for insert to authenticated
  with check (author_kind = 'user' and user_id = auth.uid() and persona is null
              and stance is null and quote_score is null);
drop policy if exists "readers delete own comments" on public.comments;
create policy "readers delete own comments" on public.comments for delete to authenticated
  using (user_id = auth.uid());
-- No update policy: edits go through delete and re-post. AI rows are written with the service role.

drop policy if exists "likes are public" on public.comment_likes;
create policy "likes are public" on public.comment_likes for select to anon, authenticated using (true);
drop policy if exists "readers like" on public.comment_likes;
create policy "readers like" on public.comment_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "readers unlike" on public.comment_likes;
create policy "readers unlike" on public.comment_likes for delete to authenticated using (user_id = auth.uid());

-- Comments with like and reply counts. Runs with its owner's rights so counts
-- include everyone; exposes no user ids beyond what comments already shows.
drop view if exists public.comment_feed;
create view public.comment_feed as
select c.id, c.paper_id, c.parent_id, c.author_kind, c.user_id, c.author_name, c.persona,
       c.body, c.stance, c.quote_score, c.created_at,
       (select count(*) from public.comment_likes l where l.comment_id = c.id)::int as likes,
       (select count(*) from public.comments r where r.parent_id = c.id)::int as replies
from public.comments c;
grant select on public.comment_feed to anon, authenticated;
