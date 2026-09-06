-- Starting a chat was refused by RLS.
--
-- Every attempt failed with "new row violates row-level security policy for
-- table conversations". The INSERT policy was never the problem: it reads
-- created_by = auth.uid(), which is correct.
--
-- What failed was the RETURNING clause. PostgREST issues every insert as
-- `insert … returning`, so the SELECT policy runs inside the same statement,
-- and a row rejected there surfaces as the same message — pointing at the
-- insert, which was fine.
--
-- The SELECT policy called can_see_conversation(id), which answers by looking
-- the room up in public.conversations. Inside the statement that creates the
-- row that lookup cannot see it, so the function returned false for the
-- creator's own brand-new room.
--
-- The fix is to judge the row the policy is already holding rather than
-- re-reading it: created_by is on the new row and needs no lookup.

drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select to authenticated
  using (created_by = auth.uid() or public.can_see_conversation(id));

-- Creating a room only has to establish you are not doing it in someone
-- else's name; who may then read it is can_see_conversation's job.
drop policy if exists "conversations_insert" on public.conversations;
create policy "conversations_insert" on public.conversations
  for insert to authenticated
  with check (created_by = auth.uid());

-- A direct room's member rows are written as a second statement, so there is a
-- moment when the room exists with none. The creator has to pass on that.
create or replace function public.can_see_conversation(conv uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.conversations c
    where c.id = conv
      and (
        exists (
          select 1 from public.conversation_members m
          where m.conversation_id = c.id and m.user_id = auth.uid()
        )
        or c.created_by = auth.uid()
        or (
          c.task_id is not null
          and (
            public.is_admin()
            or exists (
              select 1 from public.task_assignments ta
              where ta.task_id = c.task_id and ta.employee_id = auth.uid()
            )
          )
        )
      )
  );
$fn$;

grant execute on function public.can_see_conversation(uuid) to authenticated;
