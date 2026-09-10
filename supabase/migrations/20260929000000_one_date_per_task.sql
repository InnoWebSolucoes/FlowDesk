-- ============================================================================
-- One date per task.
--
-- Removing deadlines left tasks with two date fields that meant the same
-- thing: `frequency.date` on a one-off, and a per-assignee `do_date` on
-- task_assignments. The editor asked for both, they could disagree, and a
-- do_date silently beat the recurrence — so setting one on a weekly task
-- quietly turned it into a single day and cancelled every other occurrence.
--
-- A task's days now come from its frequency alone: a one-off on its date,
-- everything else on the days its rule produces.
--
-- Before dropping the column, any one-off that only ever had a do_date gets
-- it written into its frequency, so no task loses the only day it had. The
-- deadline backfill in 20260927000000 wrote a do_date onto every assignee of
-- every task that had a deadline, so this is not a rare case.
-- ============================================================================


-- ─── 1. A one-off with no date of its own takes it from the assignment ──────
-- Assignees could in principle disagree; the earliest is the honest answer,
-- since that is the day the work was first expected.

update public.tasks t
set frequency = jsonb_set(
      t.frequency::jsonb,
      '{date}',
      to_jsonb(to_char(d.first_do, 'YYYY-MM-DD'))
    )::json
from (
  select a.task_id, min(a.do_date) as first_do
  from public.task_assignments a
  where a.do_date is not null
  group by a.task_id
) d
where d.task_id = t.id
  and t.frequency->>'type' = 'one-off'
  and coalesce(t.frequency->>'date', '') = '';


-- ─── 2. A recurring task's do_date was never anything but harmful ───────────
-- Nothing to preserve: the rule already says which days it lands on, and the
-- do_date was overriding it. Recorded here rather than silently dropped with
-- the column so the intent is on the record.

-- (no statement needed — the column goes below)


-- ─── 3. Drop it ─────────────────────────────────────────────────────────────

drop index if exists public.task_assignments_do_date_idx;

alter table public.task_assignments
  drop column if exists do_date;


-- ─── 4. What is left ────────────────────────────────────────────────────────
-- Expect no do_date on task_assignments, and every one-off to have a date.

select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'task_assignments'
       and column_name = 'do_date') as do_date_columns_left,
  (select count(*) from public.tasks
     where frequency->>'type' = 'one-off'
       and coalesce(frequency->>'date', '') = '') as one_offs_with_no_date;
