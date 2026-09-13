-- ============================================================================
-- Deleting one day of a repeating task, and only that day.
--
-- Deleting a repeating task used to mean all of it: every day it had ever
-- produced and every day it would. Sometimes the answer for one day is just
-- "not this one" — so one row here says: this task, for this person, on this
-- day, does not happen. Every other day of the schedule is untouched.
--
-- A one-off has only one day, so deleting it is still deleting the task.
--
-- Only the owner deletes work. The person it belongs to can read the row, so
-- their calendar and My Tasks agree that the day is gone.
--
-- Safe to run twice.
-- ============================================================================

create table if not exists public.task_skips (
  task_id     uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.users(id) on delete cascade,
  -- The day the schedule put it on.
  due_date    date not null,
  skipped_by  uuid references public.users(id) on delete set null,
  skipped_at  timestamptz not null default now(),
  primary key (task_id, employee_id, due_date)
);

alter table public.task_skips enable row level security;

drop policy if exists task_skips_select on public.task_skips;
create policy task_skips_select on public.task_skips
  for select to authenticated
  using (public.is_owner() or employee_id = auth.uid());

drop policy if exists task_skips_write on public.task_skips;
create policy task_skips_write on public.task_skips
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Live, so the day disappears from the employee's screen as it is deleted.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'task_skips'
  ) then
    alter publication supabase_realtime add table public.task_skips;
  end if;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not found; deletions will show after a reload';
end $$;
