-- ============================================================================
-- Comments on a work log entry.
--
-- The previous attempt sent the reader to the chat page, which is the wrong
-- place: a remark about one entry belongs on that entry, under it, where both
-- people are already looking. This replaces it with a plain comment thread.
--
-- Who may read and write one is decided exactly as it is for the entry itself:
-- the person who wrote it, and the owner. No new access.
-- ============================================================================

create table if not exists public.work_log_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.work_log_entries(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists work_log_comments_entry_idx
  on public.work_log_comments(entry_id, created_at);

alter table public.work_log_comments enable row level security;

-- Readable by whoever can read the entry.
drop policy if exists "work_log_comments_select" on public.work_log_comments;
create policy "work_log_comments_select" on public.work_log_comments
  for select to authenticated using (
    exists (
      select 1 from public.work_log_entries e
      where e.id = entry_id
        and (e.author_id = auth.uid() or public.is_project_admin(e.project_id))
    )
  );

-- Written in your own name, on an entry you can read.
drop policy if exists "work_log_comments_insert" on public.work_log_comments;
create policy "work_log_comments_insert" on public.work_log_comments
  for insert to authenticated with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.work_log_entries e
      where e.id = entry_id
        and (e.author_id = auth.uid() or public.is_project_admin(e.project_id))
    )
  );

-- Your own words only.
drop policy if exists "work_log_comments_update" on public.work_log_comments;
create policy "work_log_comments_update" on public.work_log_comments
  for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- Your own, or anything on an entry the owner can see.
drop policy if exists "work_log_comments_delete" on public.work_log_comments;
create policy "work_log_comments_delete" on public.work_log_comments
  for delete to authenticated using (
    author_id = auth.uid()
    or exists (
      select 1 from public.work_log_entries e
      where e.id = entry_id and public.is_project_admin(e.project_id)
    )
  );

-- ─── Telling the other side ─────────────────────────────────────────────────
-- The notification has to point back at the entry, so the bell can open the
-- log on the right row rather than dropping the reader at the top of it.

alter table public.notifications
  add column if not exists entry_id uuid references public.work_log_entries(id) on delete cascade;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'task_assigned', 'task_due_today', 'task_due_tomorrow', 'task_overdue',
    'comment_added', 'workload_alert', 'inactivity_alert',
    'task_started', 'task_completed', 'task_reopened', 'file_uploaded',
    'chat_message', 'work_logged',
    -- Somebody commented on an entry in the work log.
    'work_log_comment'
  ));

create or replace function public.notify_work_log_comment()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  entry public.work_log_entries%rowtype;
  who text;
begin
  select * into entry from public.work_log_entries where id = new.entry_id;
  if not found then
    return new;
  end if;

  who := public.actor_name(new.author_id);

  -- The person whose entry it is, unless they are the one writing.
  if entry.author_id <> new.author_id then
    insert into public.notifications (type, title, message, entry_id, subject_user_id, target_user_id, target_role)
    values ('work_log_comment', who, new.body, entry.id, entry.author_id, entry.author_id, null);
  end if;

  -- And the managers, when it is not a manager writing.
  if not public.is_admin_user(new.author_id) then
    insert into public.notifications (type, title, message, entry_id, subject_user_id, target_user_id, target_role)
    values ('work_log_comment', who, new.body, entry.id, new.author_id, null, 'admin');
  end if;

  return new;
end;
$fn$;

drop trigger if exists work_log_comment_notify on public.work_log_comments;
create trigger work_log_comment_notify
  after insert on public.work_log_comments
  for each row execute function public.notify_work_log_comment();

-- Live, so a reply appears while the other person is looking at the entry.
do $$
begin
  alter publication supabase_realtime add table public.work_log_comments;
exception when duplicate_object then null;
end $$;

-- ─── Undoing the chat rooms ─────────────────────────────────────────────────
-- Entry discussions briefly lived in chat. Anything actually said there is
-- moved into the comments above rather than dropped, and then those rooms go.

insert into public.work_log_comments (entry_id, author_id, body, created_at)
select c.entry_id, m.author_id, m.body, m.created_at
from public.conversations c
join public.chat_messages m on m.conversation_id = c.id
where c.kind = 'work_log'
  and c.entry_id is not null
  and coalesce(m.body, '') <> ''
  and not exists (
    -- Re-running this migration must not duplicate what it already moved.
    select 1 from public.work_log_comments w
    where w.entry_id = c.entry_id
      and w.author_id = m.author_id
      and w.created_at = m.created_at
  );

delete from public.conversations where kind = 'work_log';

alter table public.conversations drop column if exists entry_id;

alter table public.conversations
  drop constraint if exists conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check check (kind in ('direct', 'task'));

-- And the message fan-out goes back to the two kinds of room that remain.
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
  label := case
    when coalesce(new.body, '') <> '' then new.body
    else 'Sent a document'
  end;

  if conv.kind = 'task' then
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

  update public.conversations set last_message_at = new.created_at where id = conv.id;
  return new;
end;
$fn$;

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
