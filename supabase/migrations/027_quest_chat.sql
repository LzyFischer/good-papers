-- 027: the chat beside each NeurIPS Quest hall (app/api/quest-chat, components/NeuripsQuest.tsx).
-- Only the server reads and writes it: it checks sign-in, length and a rate limit, and never
-- sends user ids out; players show as pixel nicknames. Safe to run once after 026.

create table if not exists public.quest_chat (
  id         uuid primary key default gen_random_uuid(),
  session    text not null check (char_length(session) between 1 and 80),
  user_id    uuid not null references auth.users(id) on delete cascade,
  nick       text not null check (char_length(nick) between 1 and 40),
  body       text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);
create index if not exists quest_chat_session on public.quest_chat (session, created_at desc);
create index if not exists quest_chat_user on public.quest_chat (user_id, created_at desc);
alter table public.quest_chat enable row level security;
-- No policies: anon and signed-in clients can't touch it directly, the service role can.
