-- ============================================================================
-- FlowDesk — chat RLS fix, the actual one.
--
-- Already applied to the linked database. Kept so a fresh deploy gets it too.
--
-- Symptom: every attempt to start a chat failed with
--   new row violates row-level security policy for table "conversations"
--
-- The INSERT policy was never the problem. It read created_by = auth.uid(),
-- which is correct, and evaluating it by hand against a real user id returned
-- true. What actually failed was the RETURNING clause: PostgREST issues every
-- insert as `insert ... returning`, so the SELECT policy runs in the same
-- statement, and a row rejected there surfaces as the same "violates
-- row-level security policy" message — pointing at the insert that was fine.
--
-- The SELECT policy called can_see_conversation(id), which answers by looking
-- the room up in public.conversations. Inside the statement that creates the
-- row, that lookup cannot see it, so the function returned false for the
-- creator's own brand-new room.
--
-- The fix is to judge the row the policy is holding rather than re-reading it.
-- created_by is on the new row and needs no lookup, so the creator passes
-- directly; the function is consulted only for rooms that already exist.
-- ============================================================================

drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select to authenticated
  using (created_by = auth.uid() or public.can_see_conversation(id));
