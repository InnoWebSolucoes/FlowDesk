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
