-- ============================================================================
-- Did the last two migrations actually land?
--
-- Run this in the Supabase SQL editor. Every row should say OK. Anything
-- saying MISSING means that migration did not run, whatever the editor said
-- at the time — a script that errors part-way through still reports the
-- statements that succeeded before it stopped.
-- ============================================================================

select
  'task_assignments.do_date dropped' as check,
  case when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_assignments'
      and column_name = 'do_date'
  ) then 'OK' else 'MISSING — run 20260929000000_one_date_per_task.sql' end as result

union all

select
  'task_statuses.started_at added',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_statuses'
      and column_name = 'started_at'
  ) then 'OK' else 'MISSING — run 20260929000001_task_started_at.sql' end

union all

select
  'every one-off has its own date',
  case when not exists (
    select 1 from public.tasks
    where frequency->>'type' = 'one-off'
      and coalesce(frequency->>'date', '') = ''
  ) then 'OK'
  else 'PROBLEM — some one-off tasks have no date and will not appear anywhere'
  end

union all

select
  'app_session_day_starts exists',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'app_session_day_starts'
  ) then 'OK' else 'MISSING — run 20260928000000_workday_start.sql' end

union all

select
  'tasks.deadline dropped',
  case when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'deadline'
  ) then 'OK' else 'MISSING — run 20260927000000_do_dates_only.sql' end

union all

select
  'project_todos.due_date dropped',
  case when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_todos'
      and column_name = 'due_date'
  ) then 'OK' else 'MISSING — run 20260927000000_do_dates_only.sql' end;
