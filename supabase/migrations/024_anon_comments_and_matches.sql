-- 024: anonymous comments, and the opt-in "Matches" between authors.
-- Safe to run once after 023.

-- 1. Anonymous comments. The row keeps its user_id (for deleting it and for moderation), but
--    no one else can read it from the table: the public feed (comment_feed, which runs as its
--    owner) shows it as "anonymous" with the user_id blanked and a `mine` flag for the author.
alter table public.comments add column if not exists anonymous boolean not null default false;

create or replace function public.comments_fill_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_kind = 'user' then
    if new.anonymous then
      new.author_name := 'anonymous';
    else
      select coalesce(raw_user_meta_data->>'user_name', raw_user_meta_data->>'name', 'reader')
        into new.author_name from auth.users where id = new.user_id;
    end if;
    new.needs_reply := true;
  end if;
  return new;
end $$;

drop policy if exists "comments are public" on public.comments;
create policy "comments are public" on public.comments for select to anon, authenticated
  using (not anonymous or user_id = auth.uid());

create or replace view public.comment_feed as
select c.id, c.paper_id, c.parent_id, c.author_kind,
       case when c.anonymous then null else c.user_id end as user_id,
       c.author_name, c.persona,
       c.body, c.stance, c.quote_score, c.created_at,
       (select count(*) from public.comment_likes l where l.comment_id = c.id)::int as likes,
       (select count(*) from public.comments r where r.parent_id = c.id)::int as replies,
       c.agent_id,
       a.owner_name as agent_owner,
       c.anonymous,
       (c.user_id is not null and c.user_id = auth.uid()) as mine
from public.comments c
left join public.agents a on a.id = c.agent_id;
grant select on public.comment_feed to anon, authenticated;

-- Replies to your comments, anonymous ones included (runs as its owner, filtered to you).
create or replace view public.my_replies with (security_invoker = false) as
select c.id, c.paper_id, c.author_kind, c.author_name, c.body, c.created_at, p.title as paper_title
from public.comments c
join public.comments mine on mine.id = c.parent_id
join public.papers p on p.id = c.paper_id
where mine.user_id = auth.uid() and c.user_id is distinct from auth.uid();
grant select on public.my_replies to authenticated;

-- 2. Matches (lib/matches.ts): readers who opted in, with papers claimed through ORCID, who
--    each read the other's papers. Reading counts in any direction: a vote either way, a ♥
--    in the home deck, or a minute on the paper page. Directions are never shown.
create table if not exists public.match_optin (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.match_optin enable row level security;
drop policy if exists "own match opt-in" on public.match_optin;
create policy "own match opt-in" on public.match_optin for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- "I'd read it" in the home deck, for signed-in readers (guests keep theirs in the browser).
create table if not exists public.paper_interest (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paper_id   text not null references public.papers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);
alter table public.paper_interest enable row level security;
drop policy if exists "own interest" on public.paper_interest;
create policy "own interest" on public.paper_interest for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
