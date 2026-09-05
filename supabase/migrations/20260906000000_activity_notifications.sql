-- Tell the managers what their staff are doing.
--
-- Until now every notification was derived on the client, in NotificationBell,
-- from task due dates. That has two consequences: nothing an employee actually
-- *does* ever notified anyone, and a notification only came into existence if
-- the right person happened to have the app open at the right moment.
--
-- These are triggers instead. The database raises them at the moment the thing
-- happens, so a manager is told whether or not anyone is looking, and the
-- record exists exactly once no matter how many clients are running.
--
-- Every one targets the admin role rather than a user, which is how the
-- existing notification fan-out already works: target_role = 'admin' is read
-- by every manager (see notifications_select).

-- ─── New notification kinds ─────────────────────────────────────────────────
-- The type column is a check constraint, so the new kinds have to be allowed
-- before anything can insert them.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    -- Existing kinds, unchanged.
    'task_assigned',
    'task_due_today',
    'task_due_tomorrow',
    'task_overdue',
    'comment_added',
    'workload_alert',
    'inactivity_alert',
    -- What an employee does.
    'task_started',
    'task_completed',
    'task_reopened',
    'file_uploaded'
  ));

-- The client de-duplicates by (type, task, target, day) before inserting. The
-- triggers below fire per event and are deliberately not deduplicated: a
-- manager wants to see that a task was started twice, or commented on twice.

-- ─── Who did it ─────────────────────────────────────────────────────────────
-- Definer so a trigger can read a name without the actor needing to be able to
-- select that row themselves.

create or replace function public.actor_name(actor uuid)
returns text
language sql stable security definer set search_path = public as $fn$
  select coalesce(name, email, 'Someone') from public.users where id = actor;
$fn$;

create or replace function public.task_title(task uuid)
returns text
language sql stable security definer set search_path = public as $fn$
  select coalesce(title, 'a task') from public.tasks where id = task;
$fn$;

-- Admins do not need telling about their own actions: a manager completing a
-- task on someone's behalf should not notify the manager who just did it.
create or replace function public.actor_is_employee(actor uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.users where id = actor and role = 'employee'
  );
$fn$;

-- ─── Started a task ─────────────────────────────────────────────────────────
-- task_statuses only ever holds 'in_progress', so a row appearing is the
-- employee saying they have started.

create or replace function public.notify_task_started()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.actor_is_employee(new.employee_id) then
    return new;
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'task_started',
    'Task started',
    public.actor_name(new.employee_id) || ' started "' || public.task_title(new.task_id) || '"',
    new.task_id,
    null,
    'admin'
  );
  return new;
end;
$fn$;

drop trigger if exists task_statuses_notify on public.task_statuses;
create trigger task_statuses_notify
  after insert on public.task_statuses
  for each row execute function public.notify_task_started();

-- ─── Completed a task ───────────────────────────────────────────────────────

create or replace function public.notify_task_completed()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.actor_is_employee(new.employee_id) then
    return new;
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'task_completed',
    case when new.was_late then 'Task completed late' else 'Task completed' end,
    public.actor_name(new.employee_id) || ' completed "' || public.task_title(new.task_id) || '"'
      || case when new.was_late then ' (late)' else '' end,
    new.task_id,
    null,
    'admin'
  );
  return new;
end;
$fn$;

drop trigger if exists completion_logs_notify on public.completion_logs;
create trigger completion_logs_notify
  after insert on public.completion_logs
  for each row execute function public.notify_task_completed();

-- ─── Un-completed a task ────────────────────────────────────────────────────
-- Marking something done and then undoing it is worth knowing about: it is the
-- one action that silently moves work back into the queue.

create or replace function public.notify_task_reopened()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.actor_is_employee(old.employee_id) then
    return old;
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'task_reopened',
    'Task marked not done',
    public.actor_name(old.employee_id) || ' reopened "' || public.task_title(old.task_id) || '"',
    old.task_id,
    null,
    'admin'
  );
  return old;
end;
$fn$;

drop trigger if exists completion_logs_notify_delete on public.completion_logs;
create trigger completion_logs_notify_delete
  after delete on public.completion_logs
  for each row execute function public.notify_task_reopened();

-- ─── Commented on a task ────────────────────────────────────────────────────
-- Managers could already read every comment; they were simply never told one
-- had been written, which is why they went unnoticed.

create or replace function public.notify_comment_added()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  preview text;
begin
  if not public.actor_is_employee(new.author_id) then
    return new;
  end if;

  -- A comment can be long; the notification carries enough to recognise it.
  preview := regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g');
  if length(preview) > 120 then
    preview := left(preview, 117) || '…';
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'comment_added',
    'New comment',
    public.actor_name(new.author_id) || ' on "' || public.task_title(new.task_id) || '": ' || preview,
    new.task_id,
    null,
    'admin'
  );
  return new;
end;
$fn$;

drop trigger if exists task_comments_notify on public.task_comments;
create trigger task_comments_notify
  after insert on public.task_comments
  for each row execute function public.notify_comment_added();

-- ─── Attached a file to a comment ───────────────────────────────────────────
-- Separate from the comment itself: a file is the thing a manager most often
-- needs to go and look at.

create or replace function public.notify_file_uploaded()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  parent_task uuid;
begin
  -- uploaded_by is on the attachment itself, so the uploader is known without
  -- going through the comment. The comment is only needed for which task.
  if not public.actor_is_employee(new.uploaded_by) then
    return new;
  end if;

  select task_id into parent_task from public.task_comments where id = new.comment_id;
  if parent_task is null then
    return new;
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'file_uploaded',
    'File uploaded',
    public.actor_name(new.uploaded_by) || ' attached "' || coalesce(new.name, 'a file')
      || '" to "' || public.task_title(parent_task) || '"',
    parent_task,
    null,
    'admin'
  );
  return new;
end;
$fn$;

drop trigger if exists task_attachments_notify on public.task_attachments;
create trigger task_attachments_notify
  after insert on public.task_attachments
  for each row execute function public.notify_file_uploaded();

-- ─── Employees writing their own boards ─────────────────────────────────────
-- Their private todos and notes are deliberately NOT notified: they are that
-- person's own workspace, and a manager being pinged for every line an
-- employee writes on their own list would bury the notifications that matter.
-- Managers can look at those boards from the employee's profile when they want
-- to. See 20260905000000_employee_workspace.sql.

-- ─── Live delivery ──────────────────────────────────────────────────────────
-- A trigger fires on the employee's action, but the manager's app is a
-- different client entirely. Without the table in the realtime publication the
-- manager would only see these by reloading, which defeats the point of
-- notifying at all.
--
-- Realtime still applies RLS per subscriber, so this does not widen who can
-- see what: a manager receives the admin-targeted rows, and an employee
-- receives only their own.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception
  -- A self-hosted or differently-named setup may not have this publication.
  -- The triggers above still work; only live delivery is lost.
  when undefined_object then
    raise notice 'supabase_realtime publication not found; notifications will not stream live';
end $$;
