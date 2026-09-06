-- Deleting a message hides it; it does not destroy the record.
--
-- A hard delete removed the row for everyone, so an employee tidying their own
-- side of a conversation erased it from the manager's too — and a message
-- somebody wanted gone was simply gone, with nothing to refer back to.
--
-- Deleting now marks the message. The person who sent it stops seeing it, and
-- so does everyone else it was sent to; managers still see it, greyed, because
-- they are answerable for what happens in the project and a conversation with
-- holes in it cannot be reviewed.
--
-- Clearing a whole room is the same act, repeated: it hides your side of it
-- and leaves the record intact.

alter table public.chat_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id) on delete set null;

create index if not exists chat_messages_deleted_idx
  on public.chat_messages(conversation_id, deleted_at);

-- ─── Who still sees a deleted message ───────────────────────────────────────
-- Everyone who could see the room keeps reading it; the app decides what to do
-- with a message that carries deleted_at. Hiding it in the policy would take
-- it from the managers too, which is the opposite of the point.

-- ─── Deleting ───────────────────────────────────────────────────────────────
-- An update rather than a delete, so the row survives. The old delete policy
-- goes: nothing should be removing these rows in normal use.

drop policy if exists "chat_messages_delete" on public.chat_messages;

-- Only a manager may remove one outright, and only as a last resort.
create policy "chat_messages_delete_admin" on public.chat_messages
  for delete to authenticated using (public.is_admin());

-- Marking one as deleted is an update. The author may hide their own; a
-- manager may hide anything in a project they run.
drop policy if exists "chat_messages_update" on public.chat_messages;
create policy "chat_messages_update" on public.chat_messages
  for update to authenticated
  using (
    author_id = auth.uid()
    or public.is_admin()
  )
  with check (
    author_id = auth.uid()
    or public.is_admin()
  );
