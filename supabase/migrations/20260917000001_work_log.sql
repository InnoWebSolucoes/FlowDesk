-- Extra work, recorded as it happens.
--
-- A task covers what was planned. What an employee actually does in a day is
-- wider than that — a call they took, a fix they made, an hour spent on
-- something nobody had written down — and until now there was nowhere to put
-- it. It went unrecorded, or it went into a chat message and was lost.
--
-- An entry is a short description, how long it took, and whatever backs it up:
-- documents already in the project, files uploaded there and then, and links.
-- Managers are told when one arrives, and can read the day, the week or the
-- month.

-- Some SQL editors run with a search_path that does not include public, and a
-- "public.projects does not exist" from a reference that plainly does exist is
-- that, not a missing table. Set it for this session and the rest reads the
-- schema it names.
set search_path = public;

create table if not exists public.work_log_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  -- The day the work happened, which is not always the day it was written up.
  worked_on date not null default current_date,
  title text not null,
  description text not null default '',
  -- Roughly how long it took. Null when they would rather not say.
  minutes int,
  created_at timestamptz not null default now()
);

create index if not exists work_log_project_day_idx
  on public.work_log_entries(project_id, worked_on desc);
create index if not exists work_log_author_idx
  on public.work_log_entries(author_id, worked_on desc);

-- Whatever backs the entry up. A document is a real resource_item, so a file
-- attached here is a project document like any other rather than something
-- that exists only inside the log.
create table if not exists public.work_log_items (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.work_log_entries(id) on delete cascade,
  item_id uuid references public.resource_items(id) on delete cascade,
  url text,
  label text,
  constraint work_log_item_target check (num_nonnulls(item_id, url) = 1)
);

create index if not exists work_log_items_entry_idx on public.work_log_items(entry_id);

-- ─── Who may read and write one ─────────────────────────────────────────────

alter table public.work_log_entries enable row level security;
alter table public.work_log_items enable row level security;

-- Your own entries, and every entry on a project you administer.
drop policy if exists "work_log_select" on public.work_log_entries;
create policy "work_log_select" on public.work_log_entries
  for select to authenticated using (
    author_id = auth.uid() or public.is_project_admin(project_id)
  );

-- Written by the person who did the work, on a project they are on.
drop policy if exists "work_log_insert" on public.work_log_entries;
create policy "work_log_insert" on public.work_log_entries
  for insert to authenticated with check (
    author_id = auth.uid()
    and (public.in_project(project_id) or public.is_project_admin(project_id))
  );

drop policy if exists "work_log_update" on public.work_log_entries;
create policy "work_log_update" on public.work_log_entries
  for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "work_log_delete" on public.work_log_entries;
create policy "work_log_delete" on public.work_log_entries
  for delete to authenticated using (
    author_id = auth.uid() or public.is_project_admin(project_id)
  );

-- Attachments follow their entry.
drop policy if exists "work_log_items_select" on public.work_log_items;
create policy "work_log_items_select" on public.work_log_items
  for select to authenticated using (
    exists (
      select 1 from public.work_log_entries e
      where e.id = entry_id
        and (e.author_id = auth.uid() or public.is_project_admin(e.project_id))
    )
  );

drop policy if exists "work_log_items_write" on public.work_log_items;
create policy "work_log_items_write" on public.work_log_items
  for all to authenticated
  using (
    exists (
      select 1 from public.work_log_entries e
      where e.id = entry_id and e.author_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.work_log_entries e
      where e.id = entry_id and e.author_id = auth.uid()
    )
  );

-- ─── Telling the managers ───────────────────────────────────────────────────

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'task_assigned', 'task_due_today', 'task_due_tomorrow', 'task_overdue',
    'comment_added', 'workload_alert', 'inactivity_alert',
    'task_started', 'task_completed', 'task_reopened', 'file_uploaded',
    'chat_message',
    -- Somebody wrote up work they had done.
    'work_logged'
  ));

create or replace function public.notify_work_logged()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  -- A manager writing up their own work does not need telling about it.
  if not public.actor_is_employee(new.author_id) then
    return new;
  end if;

  insert into public.notifications (type, title, message, subject_user_id, target_user_id, target_role)
  values (
    'work_logged',
    coalesce(public.actor_name(new.author_id), 'Someone'),
    new.title,
    new.author_id,
    null,
    'admin'
  );
  return new;
end;
$fn$;

drop trigger if exists work_log_notify on public.work_log_entries;
create trigger work_log_notify
  after insert on public.work_log_entries
  for each row execute function public.notify_work_logged();

-- Live, so a manager sees an entry arrive rather than on their next reload.
do $$
begin
  alter publication supabase_realtime add table public.work_log_entries;
exception when duplicate_object then null;
end $$;
