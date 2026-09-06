-- Deleting a task that someone had completed failed outright.
--
-- Removing a task cascades to its completion_logs, and each deleted log fires
-- notify_task_reopened(). That builds its message by concatenating
-- task_title(old.task_id) — but the task row is already gone by then, so the
-- lookup returns null, `'…' || null` is null, and the not-null constraint on
-- notifications.message aborts the whole delete.
--
-- It is not only a problem for hand-written SQL: the same trigger fires when a
-- task is deleted from the app, so any task with a completion log could not be
-- deleted at all.
--
-- Two fixes, because either alone leaves a sharp edge:
--   1. A log deleted because its task went is not someone reopening anything.
--      Say nothing in that case — the notification would be a lie.
--   2. Everywhere a title or a name is interpolated, fall back to a word
--      rather than letting one null blank the whole message.

create or replace function public.notify_task_reopened()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  -- The task is on its way out: this is a deletion, not a reopening, and
  -- there is nobody left to tell about it.
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

-- The other three are on insert paths, so they cannot hit the same race — but
-- a missing name or title would still blank their message and abort the write
-- that triggered them. Guard them the same way.

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

-- The comment trigger interpolates a name and a title the same way, so guard
-- it too rather than leaving one of the four able to blank its own message.

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
