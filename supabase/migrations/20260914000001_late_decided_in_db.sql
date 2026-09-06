-- Decide lateness in the database, not in whatever client happens to be open.
--
-- was_late arrives from the app, so the value is only ever as current as the
-- code the person is running — a cached bundle in the desktop shell kept
-- writing the old rule (`getHours() >= 16`) long after the fix was deployed,
-- and every completion after four in the afternoon was announced as late
-- however many times the data was corrected behind it.
--
-- The rule is not a client's opinion. A completion is late when the day it was
-- finished is after the day it was due, and the database can see both, so it
-- decides and overwrites whatever it was handed.

create or replace function public.set_completion_late()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  new.was_late := new.due_date is not null
    and (new.completed_at at time zone 'UTC')::date > new.due_date;
  return new;
end;
$fn$;

-- Before insert, so the value is already right by the time the notification
-- trigger reads it.
drop trigger if exists completion_logs_set_late on public.completion_logs;
create trigger completion_logs_set_late
  before insert or update of completed_at, due_date on public.completion_logs
  for each row execute function public.set_completion_late();

-- Anything already stored under the old rule.
update public.completion_logs
set was_late = due_date is not null
  and (completed_at at time zone 'UTC')::date > due_date
where was_late is distinct from (
  due_date is not null and (completed_at at time zone 'UTC')::date > due_date
);

-- And the notifications those completions raised, whose words were written
-- once and stored.
update public.notifications n
set title = 'Task completed',
    message = replace(n.message, ' (late)', '')
where n.type = 'task_completed'
  and n.title = 'Task completed late'
  and exists (
    select 1 from public.completion_logs cl
    where cl.task_id = n.task_id
      and not cl.was_late
      and (cl.completed_at at time zone 'UTC')::date = (n.created_at at time zone 'UTC')::date
  );

select
  count(*) filter (where was_late)     as still_late,
  count(*) filter (where not was_late) as on_time,
  count(*)                             as total
from public.completion_logs;
