-- ============================================================================
-- Did the migrations actually land?
--
-- Run this in the Supabase SQL editor. Every row should say OK. Anything
-- saying MISSING means that migration did not run, whatever the editor said
-- at the time — a script that errors part-way through still applies the
-- statements that succeeded before it stopped, so "no error on screen" and
-- "it all ran" are not the same thing.
--
-- The migrations are written to be safe in any order and safe to run twice,
-- so the fix for a MISSING row is always just to run that file.
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
  ) then 'OK' else 'MISSING — run 20260927000000_do_dates_only.sql' end

union all

select
  'chat_clears table exists',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'chat_clears'
  ) then 'OK' else 'MISSING — run 20260930000000_chat_clear_for_me.sql' end

union all

-- Not a migration: the three columns that look like deadlines but are not.
-- Each says which day's instance of a recurring task a row is about, so
-- losing them would take every completion record with them.
select
  'occurrence keys still present',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'due_date'
      and table_name in ('completion_logs', 'task_files', 'task_statuses')
  ) = 3 then 'OK' else 'PROBLEM — a completion-tracking column has been dropped' end

union all

select
  'task_statuses allows missed',
  case when exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'task_statuses'
      and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%missed%'
  ) then 'OK' else 'MISSING — run 20261002000000_task_missed_status.sql' end

union all

select
  'remove_website_from_list exists',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'remove_website_from_list'
  ) then 'OK' else 'MISSING — run 20261003000000_toolbox_remove_from_list.sql' end

union all

select
  'task_moves table exists',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'task_moves'
  ) then 'OK' else 'MISSING — run 20261005000000_task_moves.sql' end;
