-- ============================================================================
-- Delivery and scheduling: the two steps between an edit and its posts.
--
-- An edited batch goes to the client for approval, and once approved it is
-- loaded into the scheduler. Only then can its pieces go out. Both are days
-- on the editing session, the way the content plan is a day on the recording,
-- and each is a task of its own: somebody does it, and it gets ticked off.
--
-- A piece is ready to post from the latest of its edit, delivery and
-- scheduling days. A session with neither step behaves exactly as before.
--
-- Only adds columns. Nothing existing is changed or removed.
-- ============================================================================

alter table public.content_edits
  add column if not exists deliver_on date,
  add column if not exists deliver_assignee_id uuid references public.users(id) on delete set null,
  add column if not exists deliver_done_at timestamptz,
  add column if not exists schedule_on date,
  add column if not exists schedule_assignee_id uuid references public.users(id) on delete set null,
  add column if not exists schedule_done_at timestamptz;
