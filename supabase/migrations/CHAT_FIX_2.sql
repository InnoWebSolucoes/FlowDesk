-- ============================================================================
-- FlowDesk — chat RLS fix, take two.
--
-- Run this whole thing in the Supabase SQL editor. It is safe to re-run.
--
-- The previous fix left the same error in place. Rather than assume why, this
-- version removes the assumption: it drops EVERY policy on the four chat
-- tables by name — whatever they are called, including any left over from an
-- earlier run — and then creates one clean set.
--
-- That matters because of how Postgres combines policies. Several PERMISSIVE
-- policies for the same command are ORed, so an extra one cannot cause a
-- refusal. But a RESTRICTIVE policy is ANDed, and a single leftover
-- restrictive policy will refuse every insert no matter how permissive the
-- intended one is. Dropping by enumeration catches that case without needing
-- to know it happened.
--
-- Run CHAT_DIAGNOSE.sql afterwards if you want to see the result.
-- ============================================================================

-- ─── Clear the slate ────────────────────────────────────────────────────────
-- Every policy on these four tables, whatever it is named.

do $$
declare
  p record;
begin
  for p in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'conversations',
        'conversation_members',
        'chat_messages',
        'chat_message_items'
      )
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- RLS itself stays on. The policies below are the whole access model.
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.chat_messages        enable row level security;
alter table public.chat_message_items   enable row level security;

-- ─── Who may see a room ─────────────────────────────────────────────────────
-- Recreated here so this file stands alone: if the original migration's
-- version of this function is wrong or missing, the policies below would fail
-- for that reason instead, which is exactly the sort of thing we have been
-- chasing.

create or replace function public.can_see_conversation(conv uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.conversations c
    where c.id = conv
      and (
        -- You are in it.
        exists (
          select 1 from public.conversation_members m
          where m.conversation_id = c.id and m.user_id = auth.uid()
        )
        -- Or you made it. A direct room's member rows are written as a second
        -- statement, so there is a moment when the room exists and has none.
        or c.created_by = auth.uid()
        -- A task room: whoever the task is assigned to, plus the managers.
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

-- ─── Conversations ──────────────────────────────────────────────────────────

create policy "conversations_select" on public.conversations
  for select to authenticated
  -- created_by first, and without a lookup: PostgREST inserts with a RETURNING
  -- clause, so this policy also runs inside the statement that creates the row
  -- — where can_see_conversation() cannot see it yet and would refuse the
  -- creator their own new room.
  using (created_by = auth.uid() or public.can_see_conversation(id));

-- Creating a room only has to establish that you are not doing it in someone
-- else's name. Who may then READ it is can_see_conversation's job.
create policy "conversations_insert" on public.conversations
  for insert to authenticated
  with check (created_by = auth.uid());

create policy "conversations_update" on public.conversations
  for update to authenticated
  using (public.can_see_conversation(id))
  with check (public.can_see_conversation(id));

-- ─── Members ────────────────────────────────────────────────────────────────

create policy "conversation_members_select" on public.conversation_members
  for select to authenticated
  using (public.can_see_conversation(conversation_id));

-- Starting a direct chat writes both rows, yours and theirs, so this cannot be
-- limited to your own id.
create policy "conversation_members_insert" on public.conversation_members
  for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
    or public.can_see_conversation(conversation_id)
  );

-- Your own read marker, and no one else's.
create policy "conversation_members_update" on public.conversation_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── Messages ───────────────────────────────────────────────────────────────

create policy "chat_messages_select" on public.chat_messages
  for select to authenticated
  using (public.can_see_conversation(conversation_id));

create policy "chat_messages_insert" on public.chat_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_see_conversation(conversation_id)
  );

create policy "chat_messages_update" on public.chat_messages
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- A manager may clear anything; everyone else only their own words.
create policy "chat_messages_delete" on public.chat_messages
  for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- ─── Documents on a message ─────────────────────────────────────────────────

create policy "chat_message_items_select" on public.chat_message_items
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and public.can_see_conversation(m.conversation_id)
    )
  );

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

-- ─── Report ─────────────────────────────────────────────────────────────────
-- What this file just put in place. Every row should say PERMISSIVE.

select tablename, policyname, cmd, permissive
from pg_policies
where schemaname = 'public'
  and tablename in (
    'conversations',
    'conversation_members',
    'chat_messages',
    'chat_message_items'
  )
order by tablename, cmd, policyname;
