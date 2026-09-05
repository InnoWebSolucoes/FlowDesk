-- Flow Desk's own messaging.
--
-- Two kinds of conversation live in one table, told apart by `kind`:
--
--   direct — two people. The pair is held in `conversation_members`, and a
--            deterministic key stops the same pair opening two rooms.
--   task   — the discussion of one task. This replaces the comment panel that
--            used to sit on the task card: task talk now happens in chat and
--            nowhere else, with the room carrying the task it is about so the
--            reader can jump back to it.
--
-- Every conversation also owns a resources cluster. A file sent in chat is a
-- real project document, filed in that room's cluster, rather than an
-- attachment that exists only inside the thread.

-- ─── Conversations ──────────────────────────────────────────────────────────

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'task')),
  project_id uuid references public.projects(id) on delete cascade,
  -- Set when kind = 'task'. One room per task, enforced below.
  task_id uuid references public.tasks(id) on delete cascade,
  -- The room's folder in Resources. Created lazily on the first upload, so a
  -- conversation nobody sends a file in never litters the canvas.
  cluster_id uuid references public.resource_clusters(id) on delete set null,
  -- 'a:b' of the two member ids, sorted, for kind = 'direct'. Two people
  -- opening a chat with each other at the same moment would otherwise create
  -- two rooms; the unique index below makes the second attempt a no-op.
  pair_key text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Touched on every message so the conversation list can sort by recency
  -- without aggregating over messages.
  last_message_at timestamptz not null default now()
);

create unique index if not exists conversations_task_uniq
  on public.conversations(task_id) where task_id is not null;
create unique index if not exists conversations_pair_uniq
  on public.conversations(pair_key) where pair_key is not null;
create index if not exists conversations_recent_idx
  on public.conversations(last_message_at desc);

-- ─── Who is in the room ─────────────────────────────────────────────────────
-- Direct rooms list their two people here. Task rooms do not: their membership
-- is derived — the assignees plus the managers — so that reassigning a task
-- moves the conversation with it rather than stranding it with whoever was
-- assigned on the day it was created.

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  -- What this person has read up to. Drives the unread badge.
  last_read_at timestamptz not null default 'epoch',
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members(user_id);

-- ─── Messages ───────────────────────────────────────────────────────────────

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages(conversation_id, created_at);

-- ─── Documents on a message ─────────────────────────────────────────────────
-- A reference to a real resource_item, not a copy of the file. Sending a
-- document you already have and uploading a new one therefore end up the same
-- shape, and deleting the document removes it from the thread rather than
-- leaving a row pointing at a file that is gone.

create table if not exists public.chat_message_items (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  item_id uuid not null references public.resource_items(id) on delete cascade,
  unique (message_id, item_id)
);

create index if not exists chat_message_items_message_idx
  on public.chat_message_items(message_id);

-- ─── Who may see a conversation ─────────────────────────────────────────────
-- Definer, because answering it means reading task assignments and the members
-- table — and the members policy itself has to ask this question, which would
-- recurse if it went through RLS.

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
      )
  );
$fn$;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_items enable row level security;

-- Conversations ─────────────
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select to authenticated using (public.can_see_conversation(id));

-- Anyone may start a conversation, but only one they are actually part of: a
-- direct room they are in, or the room for a task they can see.
drop policy if exists "conversations_insert" on public.conversations;
create policy "conversations_insert" on public.conversations
  for insert to authenticated with check (
    created_by = auth.uid()
    and (
      kind = 'direct'
      or (
        kind = 'task' and (
          public.is_admin()
          or exists (
            select 1 from public.task_assignments ta
            where ta.task_id = conversations.task_id and ta.employee_id = auth.uid()
          )
        )
      )
    )
  );

-- Members touch last_message_at on send, and set the room's cluster the first
-- time a file goes in. Nothing else about a room is editable.
drop policy if exists "conversations_update" on public.conversations;
create policy "conversations_update" on public.conversations
  for update to authenticated
  using (public.can_see_conversation(id))
  with check (public.can_see_conversation(id));

-- Members ─────────────
-- Selecting members is how the UI names the other person in a direct room, so
-- it is readable by anyone who can see the room.
drop policy if exists "conversation_members_select" on public.conversation_members;
create policy "conversation_members_select" on public.conversation_members
  for select to authenticated using (public.can_see_conversation(conversation_id));

-- Starting a direct chat means writing both rows — yours and theirs — so this
-- cannot be limited to your own id.
drop policy if exists "conversation_members_insert" on public.conversation_members;
create policy "conversation_members_insert" on public.conversation_members
  for insert to authenticated with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_members.conversation_id and c.created_by = auth.uid()
    )
    -- A task room has no member rows until someone reads it, and the read
    -- marker is written by upsert — so anyone who can see the room must be
    -- able to insert their own marker into it.
    or public.can_see_conversation(conversation_members.conversation_id)
  );

-- Only your own read marker.
drop policy if exists "conversation_members_update" on public.conversation_members;
create policy "conversation_members_update" on public.conversation_members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Messages ─────────────
drop policy if exists "chat_messages_select" on public.chat_messages;
create policy "chat_messages_select" on public.chat_messages
  for select to authenticated using (public.can_see_conversation(conversation_id));

drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages
  for insert to authenticated with check (
    author_id = auth.uid() and public.can_see_conversation(conversation_id)
  );

drop policy if exists "chat_messages_update" on public.chat_messages;
create policy "chat_messages_update" on public.chat_messages
  for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- A manager may clear anything; everyone else only their own words.
drop policy if exists "chat_messages_delete" on public.chat_messages;
create policy "chat_messages_delete" on public.chat_messages
  for delete to authenticated using (author_id = auth.uid() or public.is_admin());

-- Message documents ─────────────
drop policy if exists "chat_message_items_select" on public.chat_message_items;
create policy "chat_message_items_select" on public.chat_message_items
  for select to authenticated using (
    exists (
      select 1 from public.chat_messages m
      where m.id = chat_message_items.message_id
        and public.can_see_conversation(m.conversation_id)
    )
  );

drop policy if exists "chat_message_items_write" on public.chat_message_items;
create policy "chat_message_items_write" on public.chat_message_items
  for all to authenticated
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = chat_message_items.message_id and m.author_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_messages m
      where m.id = chat_message_items.message_id and m.author_id = auth.uid()
    )
  );

-- ─── A room's folder ────────────────────────────────────────────────────────
-- Clusters are otherwise admin-only, because a cluster carries the access
-- rules that decide who sees what. A conversation's own folder is the one
-- exception: it is created for a room the caller is already in, so it grants
-- nothing they did not already have. Definer, since the employee cannot insert
-- a cluster themselves.

create or replace function public.ensure_conversation_cluster(conv uuid, folder_title text)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  existing uuid;
  proj uuid;
  parent uuid;
  made uuid;
begin
  if not public.can_see_conversation(conv) then
    raise exception 'not a member of this conversation';
  end if;

  select cluster_id, project_id into existing, proj from public.conversations where id = conv;
  if existing is not null then
    return existing;
  end if;

  -- A task room has no project of its own; take it from the task.
  if proj is null then
    select t.project_id into proj
    from public.conversations c join public.tasks t on t.id = c.task_id
    where c.id = conv;
  end if;
  if proj is null then
    return null;
  end if;

  -- Every chat folder hangs under one "Chat" bubble, so rooms do not scatter
  -- across the canvas.
  select id into parent from public.resource_clusters
  where project_id = proj and parent_cluster_id is null and title = 'Chat'
  limit 1;

  if parent is null then
    insert into public.resource_clusters (project_id, parent_cluster_id, title, color, x, y, radius)
    values (proj, null, 'Chat', '#25d366', 0, 0, 160)
    returning id into parent;
  end if;

  insert into public.resource_clusters (project_id, parent_cluster_id, title, color, x, y, radius)
  values (proj, parent, coalesce(nullif(folder_title, ''), 'Conversation'), '#25d366', 0, 0, 120)
  returning id into made;

  update public.conversations set cluster_id = made where id = conv;
  return made;
end;
$fn$;

grant execute on function public.ensure_conversation_cluster(uuid, text) to authenticated;

-- ─── Being told about a message ─────────────────────────────────────────────
-- A message is only useful if the other person learns of it while they are
-- elsewhere in the app, so each one raises a notification for every member of
-- the room except its author.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'task_assigned',
    'task_due_today',
    'task_due_tomorrow',
    'task_overdue',
    'comment_added',
    'workload_alert',
    'inactivity_alert',
    'task_started',
    'task_completed',
    'task_reopened',
    'file_uploaded',
    -- A message in chat.
    'chat_message'
  ));

-- Where a notification should land when opened. A chat notification has to
-- name its room, which is not a task, so task_id alone can no longer carry it.
alter table public.notifications
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;

-- actor_is_employee asks about the caller's own row; the fan-out below needs
-- the same question asked about an arbitrary user.
create or replace function public.is_admin_user(who uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.users where id = who and role = 'admin');
$fn$;

create or replace function public.notify_chat_message()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  conv public.conversations%rowtype;
  who text;
  label text;
  recipient uuid;
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

drop trigger if exists chat_message_notify on public.chat_messages;
create trigger chat_message_notify
  after insert on public.chat_messages
  for each row execute procedure public.notify_chat_message();

-- ─── Live ───────────────────────────────────────────────────────────────────
-- Chat is worthless without it: every message is written on someone else's
-- machine.

do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null;
end $$;
