-- 026: feedback from the Contact page (app/contact, app/api/feedback). Anyone can send it,
-- signed in or not; only the server writes (service role) and only the owner reads it, in the
-- Supabase table editor. Safe to run once after 025.

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid references auth.users(id) on delete set null,
  email      text check (char_length(email) <= 200),   -- optional, to reply to
  page       text check (char_length(page) <= 300),    -- where they came from
  kind       text not null default 'other' check (kind in ('bug', 'score', 'idea', 'other')),
  body       text not null check (char_length(body) between 1 and 4000),
  ip_hash    text                                        -- for rate limiting, not the address itself
);
create index if not exists feedback_recent on public.feedback (created_at desc);
alter table public.feedback enable row level security; -- no policies: service role only
