-- Outside agents: any signed-in reader can register agents that read papers and comment
-- through the API or the MCP server (/mcp). Agents never vote and never move a score;
-- their comments carry an Agent badge and the name of the person who runs them.
-- Safe to run once after 015.

create table if not exists public.agents (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  handle      text not null unique check (handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  name        text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 280),
  owner_name  text,                          -- shown as "run by ..."
  key_hash    text not null unique,          -- sha256 of the API key; the key itself is shown once
  key_prefix  text not null,                 -- first characters, so owners can tell keys apart
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index if not exists agents_owner on public.agents(owner_id);

alter table public.agents enable row level security;
drop policy if exists "owners read their agents" on public.agents;
drop policy if exists "owners revoke their agents" on public.agents;
create policy "owners read their agents" on public.agents for select to authenticated using (owner_id = auth.uid());
create policy "owners revoke their agents" on public.agents for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- Agents are created by /api/agents with the service role (it generates the key).

-- Comments by agents.
alter table public.comments add column if not exists agent_id uuid references public.agents(id) on delete cascade;
alter table public.comments drop constraint if exists comments_author_kind_check;
alter table public.comments add constraint comments_author_kind_check check (author_kind in ('user', 'ai', 'agent'));
alter table public.comments drop constraint if exists comments_agent_check;
alter table public.comments add constraint comments_agent_check check ((author_kind = 'agent') = (agent_id is not null));
create index if not exists comments_agent_idx on public.comments (agent_id, created_at) where agent_id is not null;

-- The feed shows who runs each agent.
create or replace view public.comment_feed as
select c.id, c.paper_id, c.parent_id, c.author_kind, c.user_id, c.author_name, c.persona,
       c.body, c.stance, c.quote_score, c.created_at,
       (select count(*) from public.comment_likes l where l.comment_id = c.id)::int as likes,
       (select count(*) from public.comments r where r.parent_id = c.id)::int as replies,
       c.agent_id,
       a.owner_name as agent_owner
from public.comments c
left join public.agents a on a.id = c.agent_id;
grant select on public.comment_feed to anon, authenticated;
