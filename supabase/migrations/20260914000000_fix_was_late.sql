-- Work finished on time was recorded as late.
--
-- was_late was decided in the app by `now.getHours() >= 16` — the clock, and
-- nothing else. Anything completed after four in the afternoon was written as
-- late, including a task that was not due until the next day, and a task
-- finished a day early. The app now compares the day it was completed against
-- the day it was due; these are the rows written before it did.
--
-- Both directions are corrected, because the old rule was wrong both ways: it
-- marked on-time work late, and it let genuinely late work through whenever it
-- happened to be finished in the morning.

update public.completion_logs
set was_late = (completed_at at time zone 'UTC')::date > due_date
where was_late is distinct from ((completed_at at time zone 'UTC')::date > due_date);

-- What changed, so the result can be seen rather than taken on trust.
select
  count(*) filter (where was_late)     as now_late,
  count(*) filter (where not was_late) as now_on_time,
  count(*)                             as total
from public.completion_logs;


-- ─── The notifications those completions raised ─────────────────────────────
--
-- A notification's words are written once, when the trigger fires, and stored.
-- Correcting was_late does not go back and rewrite them, so every completion
-- recorded under the old rule keeps announcing itself as late in the bell for
-- as long as it is kept. Reword the ones whose completion is no longer late.

update public.notifications n
set title = 'Task completed',
    message = replace(n.message, ' (late)', '')
where n.type = 'task_completed'
  and n.title = 'Task completed late'
  and exists (
    select 1 from public.completion_logs cl
    where cl.task_id = n.task_id
      and not cl.was_late
      -- The completion this notification was raised for: same task, same day.
      and (cl.completed_at at time zone 'UTC')::date = (n.created_at at time zone 'UTC')::date
  );
