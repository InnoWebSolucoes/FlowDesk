-- ============================================================================
-- A work log entry can be discussed, the same way a task can.
--
-- Tasks already have a room of their own: open the discussion from the card
-- and everyone the task concerns is in it. An entry in the work log had
-- nowhere to go — a manager reading "spent two hours on the migration" could
-- only start a direct chat and quote it, which loses what it was about.
--
-- This adds a third kind of conversation, keyed to the entry. Its audience is
-- the person who wrote the entry plus the project's managers — the same people
-- who can read the entry itself, so the room grants nobody anything new.
--
-- Nothing here reads or changes existing rows.
-- ============================================================================

alter table public.conversations
  add column if not exists entry_id uuid references public.work_log_entries(id) on delete cascade;

-- 'work_log' joins 'direct' and 'task' as a kind of room.
alter table public.conversations
  drop constraint if exists conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('direct', 'task', 'work_log'));

-- One room per entry, as with tasks.
create unique index if not exists conversations_entry_uniq
  on public.conversations(entry_id) where entry_id is not null;

-- ─── Who may see one ────────────────────────────────────────────────────────
-- Restated whole rather than patched: this is the one function every chat
-- policy asks, and it should be readable in one piece. The direct and task
-- branches are unchanged; the work_log branch is new.

create or replace function public.can_see_conversation(conv uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.conversations c
    where c.id = conv
      and (
        -- A direct room: you are one of the two people in it.
        exists (
          select 1 from public.conversation_members m
          where m.conversation_id = c.id and m.user_id = auth.uid()
        )
        -- Or you have only just created it. A direct room's members are
        -- written as a second statement, so between the insert and that write
        -- there is a moment with no member rows at all — and the insert's own
        -- RETURNING clause reads through this function. Without this the
        -- creator could not see the room they had just made.
        or c.created_by = auth.uid()
        -- A task room: the people the task is assigned to, plus the managers.
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
        -- A work log room: whoever wrote the entry, and the managers of the
        -- project it belongs to. Exactly who can read the entry itself.
        or (
          c.entry_id is not null
          and exists (
            select 1 from public.work_log_entries e
            where e.id = c.entry_id
              and (e.author_id = auth.uid() or public.is_project_admin(e.project_id))
          )
        )
      )
  );
$fn$;

-- ─── Telling the other side ─────────────────────────────────────────────────
-- Same shape as the task branch: the author of the entry, and the managers as
-- a role. Derived rather than stored, so nothing goes stale.

create or replace function public.notify_chat_message()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  conv public.conversations%rowtype;
  who text;
  label text;
  recipient uuid;
  entry public.work_log_entries%rowtype;
begin
  select * into conv from public.conversations where id = new.conversation_id;
  if not found then
    return new;
  end if;

  who := public.actor_name(new.author_id);
  -- The preview stands in for the message when it is only a document.
  label := case
    when coalesce(new.body, '') <> '' then new.body
    else 'Sent a document'
  end;

  if conv.kind = 'task' then
    -- Task talk goes to everyone the task concerns: the assignees, and the
    -- managers as a role. Derived, so reassignment moves the audience.
    for recipient in
      select ta.employee_id from public.task_assignments ta
      where ta.task_id = conv.task_id and ta.employee_id <> new.author_id
    loop
      insert into public.notifications (type, title, message, task_id, conversation_id, target_user_id, target_role)
      values ('chat_message', who, label, conv.task_id, conv.id, recipient, null);
    end loop;

    if not public.is_admin_user(new.author_id) then
      insert into public.notifications (type, title, message, task_id, conversation_id, target_user_id, target_role)
      values ('chat_message', who, label, conv.task_id, conv.id, null, 'admin');
    end if;

  elsif conv.kind = 'work_log' then
    select * into entry from public.work_log_entries where id = conv.entry_id;

    -- The person whose work is being discussed, unless they are the one
    -- writing.
    if found and entry.author_id <> new.author_id then
      insert into public.notifications (type, title, message, conversation_id, target_user_id, target_role)
      values ('chat_message', who, label, conv.id, entry.author_id, null);
    end if;

    -- And the managers, when it is not a manager talking.
    if not public.is_admin_user(new.author_id) then
      insert into public.notifications (type, title, message, conversation_id, target_user_id, target_role)
      values ('chat_message', who, label, conv.id, null, 'admin');
    end if;

  else
    for recipient in
      select m.user_id from public.conversation_members m
      where m.conversation_id = conv.id and m.user_id <> new.author_id
    loop
      insert into public.notifications (type, title, message, task_id, conversation_id, target_user_id, target_role)
      values ('chat_message', who, label, null, conv.id, recipient, null);
    end loop;
  end if;

  -- Keeps the conversation list ordered by recency.
  update public.conversations set last_message_at = new.created_at where id = conv.id;
  return new;
end;
$fn$;
