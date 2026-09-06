-- ============================================================================
-- FlowDesk — chat RLS fix.
--
-- Run this on its own in the Supabase SQL editor. It is small and safe to run
-- more than once.
--
-- Symptom: starting any chat failed with
--   "new row violates row-level security policy for table conversations"
--
-- Cause: three of the chat write policies referenced the row being inserted by
-- qualified name — conversations.task_id, conversation_members.conversation_id,
-- chat_message_items.message_id — inside a WITH CHECK clause. A WITH CHECK is
-- evaluated against the row being written, which is not reliably addressable
-- that way, so the subqueries did not see the values being inserted and the
-- checks failed. The fix is the bare column name in each case.
--
-- The conversations policy is also simplified. Who may READ a room is decided
-- by can_see_conversation; the insert only has to establish that you are not
-- creating a room in someone else's name.
-- ============================================================================

-- ─── Starting a conversation ────────────────────────────────────────────────

drop policy if exists "conversations_insert" on public.conversations;
create policy "conversations_insert" on public.conversations
  for insert to authenticated with check (created_by = auth.uid());

-- ─── Joining people to it ───────────────────────────────────────────────────
-- Starting a direct chat means writing both rows — yours and theirs — so this
-- cannot be limited to your own id.

drop policy if exists "conversation_members_insert" on public.conversation_members;
create policy "conversation_members_insert" on public.conversation_members
  for insert to authenticated with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
    -- A task room has no member rows until someone reads it, and the read
    -- marker is written by upsert — so anyone who can see the room must be
    -- able to insert their own marker into it.
    or public.can_see_conversation(conversation_id)
  );

-- ─── Documents on a message ─────────────────────────────────────────────────

drop policy if exists "chat_message_items_select" on public.chat_message_items;
create policy "chat_message_items_select" on public.chat_message_items
  for select to authenticated using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and public.can_see_conversation(m.conversation_id)
    )
  );

drop policy if exists "chat_message_items_write" on public.chat_message_items;
create policy "chat_message_items_write" on public.chat_message_items
  for all to authenticated
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id and m.author_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id and m.author_id = auth.uid()
    )
  );
