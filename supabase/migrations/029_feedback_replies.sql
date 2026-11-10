-- 029: the owner's replies to feedback, sent from /admin/feedback as hello@goodpapers.org
-- (app/api/feedback/reply, Resend). Kept with the message so the inbox shows what was said.
-- Safe to run once after 028.
alter table public.feedback add column if not exists reply_body text check (char_length(reply_body) <= 8000);
alter table public.feedback add column if not exists replied_at timestamptz;
