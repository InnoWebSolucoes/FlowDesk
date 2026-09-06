-- ============================================================================
-- FlowDesk — everything still outstanding, in one file.
--
-- Run this whole thing once in the Supabase SQL editor. Safe to re-run: every
-- statement is `create or replace` or guarded, so a second run changes nothing.
--
-- What is NOT in here, because it is already applied to your database:
--   the employee workspace, activity notifications, task dates, rich notes,
--   relative cluster access, chat and its RLS fix, the day-based calendar,
--   project admins, the scoped admin policies, and multi-project membership.
--   All verified present before writing this.
--
-- What IS in here:
--   1. The notification triggers that could not survive a task being deleted.
--   2. A guard so an admin cannot quietly become the owner.
-- ============================================================================


-- ############################################################################
-- 1. Deleting a task that had ever been completed
-- ############################################################################
--
-- Removing a task cascades to its completion_logs, and each deleted log fires
-- notify_task_reopened(). That built its message around task_title(task_id) —
-- but the task row is gone by then, the lookup returns null, `'…' || null` is
-- null, and the not-null constraint on notifications.message aborts the whole
-- delete.
--
-- You have already run the notify_task_reopened() half of this to unblock a
-- deletion. The other three triggers interpolate a name and a title the same
-- way: no null can reach them today, but one missing row would blank the
-- message and take down the write that triggered it. They are guarded here so
-- the same failure cannot appear somewhere else later.

create or replace function public.notify_task_reopened()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  -- The task is on its way out: this is a deletion, not somebody reopening
  -- anything, and there is nobody left to tell.
  if not exists (select 1 from public.tasks where id = old.task_id) then
    return old;
  end if;

  if not public.actor_is_employee(old.employee_id) then
    return old;
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'task_reopened',
    'Task marked not done',
    coalesce(public.actor_name(old.employee_id), 'Someone')
      || ' reopened "' || coalesce(public.task_title(old.task_id), 'a task') || '"',
    old.task_id,
    null,
    'admin'
  );

  return old;
end;
$fn$;

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
    coalesce(public.actor_name(new.employee_id), 'Someone')
      || ' started "' || coalesce(public.task_title(new.task_id), 'a task') || '"',
    new.task_id,
    null,
    'admin'
  );

  return new;
end;
$fn$;

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
    coalesce(public.actor_name(new.employee_id), 'Someone')
      || ' completed "' || coalesce(public.task_title(new.task_id), 'a task') || '"'
      || case when new.was_late then ' (late)' else '' end,
    new.task_id,
    null,
    'admin'
  );

  return new;
end;
$fn$;

create or replace function public.notify_comment_added()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  preview text;
begin
  if not public.actor_is_employee(new.author_id) then
    return new;
  end if;

  preview := regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g');
  if length(preview) > 120 then
    preview := left(preview, 117) || '…';
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'comment_added',
    'New comment',
    coalesce(public.actor_name(new.author_id), 'Someone')
      || ' on "' || coalesce(public.task_title(new.task_id), 'a task') || '": ' || preview,
    new.task_id,
    null,
    'admin'
  );

  return new;
end;
$fn$;


-- ############################################################################
-- 2. Only the owner may change ownership
-- ############################################################################
--
-- The users table is writable by admins for the people on their projects,
-- which is what lets them edit a job title. is_owner sits on that same row, so
-- without this an admin could set it on themselves and take full access to
-- every project.
--
-- A policy cannot see the old value on an update, so this is a trigger.

create or replace function public.guard_owner_flag() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if (tg_op = 'INSERT' and new.is_owner)
     or (tg_op = 'UPDATE' and new.is_owner is distinct from old.is_owner) then
    if not public.is_owner() then
      raise exception 'Only the owner can change ownership';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists guard_owner_flag on public.users;
create trigger guard_owner_flag
  before insert or update on public.users
  for each row execute procedure public.guard_owner_flag();


-- ############################################################################
-- Report
-- ############################################################################
-- Both rows should come back true.

select
  (select count(*) = 4 from pg_proc
    where proname in (
      'notify_task_reopened', 'notify_task_started',
      'notify_task_completed', 'notify_comment_added'
    )) as triggers_updated,
  (select exists (
    select 1 from pg_trigger where tgname = 'guard_owner_flag'
  )) as ownership_guarded;
