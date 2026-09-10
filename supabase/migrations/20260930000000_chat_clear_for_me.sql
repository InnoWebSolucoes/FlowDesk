-- ============================================================================
-- Clearing a chat for yourself, without clearing it for the other person.
--
-- There was one kind of clear: soft-delete every message, for everybody. That
-- is the right thing for a manager tidying a thread up, and quite wrong for
-- an employee who just wants their own list clean — it reached across and
-- deleted the other side's copy of a conversation they were part of.
--
-- So a per-person marker. Clearing records the moment, and that person stops
-- seeing anything sent before it. Nothing is destroyed: the messages stay
-- where they are, the other side is untouched, and the same conversation
-- carries on from the next message.
-- ============================================================================

create table if not exists public.chat_clears (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.chat_clears enable row level security;

-- Yours alone, in every direction. Nobody needs to know that somebody else
-- cleared their copy, and nobody may clear on another person's behalf.
drop policy if exists "chat_clears_select_self" on public.chat_clears;
create policy "chat_clears_select_self" on public.chat_clears
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "chat_clears_insert_self" on public.chat_clears;
create policy "chat_clears_insert_self" on public.chat_clears
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "chat_clears_update_self" on public.chat_clears;
create policy "chat_clears_update_self" on public.chat_clears
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "chat_clears_delete_self" on public.chat_clears;
create policy "chat_clears_delete_self" on public.chat_clears
  for delete to authenticated using (user_id = auth.uid());
