-- 025: messages between matched authors (lib/messages.ts, app/api/messages).
-- Only the server writes messages, after checking the two readers are a mutual match and
-- neither blocked the other; readers read their own conversations. Safe to run once after 024.

create table if not exists public.match_messages (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid not null references auth.users(id) on delete cascade,
  recipient  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  check (sender <> recipient)
);
create index if not exists match_messages_inbox on public.match_messages (recipient, created_at desc);
create index if not exists match_messages_pair on public.match_messages (sender, recipient, created_at desc);
alter table public.match_messages enable row level security;
drop policy if exists "read own messages" on public.match_messages;
create policy "read own messages" on public.match_messages for select to authenticated
  using (auth.uid() = sender or auth.uid() = recipient);

-- Blocking someone hides the match and stops messages both ways.
create table if not exists public.match_blocks (
  blocker    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table public.match_blocks enable row level security;
drop policy if exists "own blocks" on public.match_blocks;
create policy "own blocks" on public.match_blocks for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());

-- Reports, for the site owner to look at (service role only reads them).
create table if not exists public.message_reports (
  id         uuid primary key default gen_random_uuid(),
  reporter   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message_id uuid not null references public.match_messages(id) on delete cascade,
  reason     text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
alter table public.message_reports enable row level security;
drop policy if exists "file a report" on public.message_reports;
create policy "file a report" on public.message_reports for insert to authenticated
  with check (reporter = auth.uid() and exists (
    select 1 from public.match_messages m where m.id = message_id and m.recipient = auth.uid()));
