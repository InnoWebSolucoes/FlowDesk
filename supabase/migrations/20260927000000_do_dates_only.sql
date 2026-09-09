-- ============================================================================
-- One date. The due-date system is gone; a do date is what "it must be done"
-- means now.
--
-- Two dates per piece of work was one too many. Every todo and every task
-- carried a deadline *and* a do date, which meant reading both to answer the
-- only question anyone actually asks — what day is this happening on — and
-- the calendar drew the same task twice, filled on its do date and as a faded
-- red marker on its deadline, in two colours meaning two different things.
--
-- Nothing is thrown away. The deadline becomes the do date wherever no do
-- date was set, so work that was only ever described by its deadline keeps
-- the day it had and lands on the calendar as work rather than disappearing.
-- Where both were set, the do date already said which day the work happens,
-- and it wins.
--
-- NOT touched, despite the name: completion_logs.due_date, task_files.due_date
-- and task_statuses.due_date. Those are occurrence keys — which day's instance
-- of a recurring task this row is about — not deadlines. Dropping them would
-- take every completion record with them.
-- ============================================================================


-- ─── 1. Todos: due_date → do_date ───────────────────────────────────────────

update public.project_todos
set do_date = due_date
where do_date is null
  and due_date is not null;

alter table public.project_todos
  drop column if exists due_date;


-- ─── 2. Tasks: deadline → each assignee's do_date ───────────────────────────
-- The deadline sat on the task and the do date sits on the assignment, so one
-- deadline becomes a day for each person the task is assigned to. Only where
-- that person has no day of their own already.

update public.task_assignments a
set do_date = t.deadline
from public.tasks t
where a.task_id = t.id
  and a.do_date is null
  and t.deadline is not null;

drop index if exists public.tasks_deadline_idx;

alter table public.tasks
  drop column if exists deadline;


-- ─── 3. What is left ────────────────────────────────────────────────────────
-- Expect no due_date on project_todos, no deadline on tasks, and the three
-- occurrence columns still present.

select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'project_todos' and column_name in ('due_date', 'do_date'))
    or (table_name = 'tasks' and column_name = 'deadline')
    or (table_name = 'task_assignments' and column_name = 'do_date')
    or (table_name in ('completion_logs', 'task_files', 'task_statuses')
        and column_name = 'due_date')
  )
order by table_name, column_name;
