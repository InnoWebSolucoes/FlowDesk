-- Two dates on a task, the way the todos already have them.
--
-- Until now a task had only its recurrence: a one-off carried a date inside
-- its frequency JSON, and everything else had no date at all. So "what do I
-- have to finish by today" could not be answered, and nothing an employee was
-- assigned ever reached their calendar.
--
--   deadline  — the date it must be finished by. Set by the manager when the
--               task is created, and may be left empty.
--   do_date   — the day the employee plans to actually do it. Theirs to set,
--               and what the calendar shows. May also be empty.
--
-- This mirrors project_todos exactly (due_date / do_date), so both kinds of
-- work read the same way on the calendar.

-- ─── The deadline lives on the task ─────────────────────────────────────────
-- One deadline for the task, set by whoever assigned it.

alter table public.tasks
  add column if not exists deadline date;

create index if not exists tasks_deadline_idx on public.tasks(deadline);

-- Backfill: a one-off's frequency date has always been its deadline in all but
-- name, so carry it across rather than losing it.
update public.tasks
set deadline = (frequency->>'date')::date
where deadline is null
  and frequency->>'type' = 'one-off'
  and frequency->>'date' is not null
  -- Guard against a malformed value stopping the whole migration.
  and (frequency->>'date') ~ '^\d{4}-\d{2}-\d{2}';

-- ─── The do date is per person ──────────────────────────────────────────────
-- A task can be assigned to several people, and they will not all plan to do
-- it on the same day, so the do date belongs to the assignment rather than the
-- task. task_assignments is already keyed (task_id, employee_id).

alter table public.task_assignments
  add column if not exists do_date date,
  -- Optional time window, so a task can be dropped into a specific slot on the
  -- calendar rather than sitting as an all-day item.
  add column if not exists do_start time,
  add column if not exists do_end time;

create index if not exists task_assignments_do_date_idx
  on public.task_assignments(employee_id, do_date);

-- ─── Employees schedule their own work ──────────────────────────────────────
-- Assignments were admin-only for writes, which is right for *who* a task goes
-- to, but an employee has to be able to say when they intend to do it.
-- Updating their own row is allowed; inserting or deleting one is not, so they
-- still cannot assign work to themselves or drop it.

create policy "task_assignments_update_own" on public.task_assignments
  for update to authenticated
  using (employee_id = auth.uid())
  with check (employee_id = auth.uid());

-- ─── Live delivery ──────────────────────────────────────────────────────────
-- An admin assigning a task writes on their machine; the employee's app is a
-- different client. Without these in the realtime publication the employee had
-- to reload before a new task appeared, which is what made the app feel stale.
--
-- RLS still applies per subscriber, so this changes delivery, not visibility.

do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks',
    'task_assignments',
    'completion_logs',
    'task_statuses',
    'task_comments',
    'project_todos',
    'project_todo_lists',
    'project_notes',
    'project_note_items',
    'calendar_entries'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not found; live updates unavailable';
end $$;
