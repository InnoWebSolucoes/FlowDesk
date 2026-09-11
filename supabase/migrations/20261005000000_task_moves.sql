-- ============================================================================
-- Moving one day of a recurring task to another day.
--
-- Dragging a task on the calendar to a different day. For a one-off task
-- that changes the task's own date, and no table is needed. For a recurring
-- task — daily, weekly, monthly — the day comes from its frequency, and
-- moving *this Tuesday's* copy must not move every Tuesday. So one row here
-- says: this task, for this person, on this day, now happens on that day.
--
-- The occurrence keeps its original date as its identity: completion logs,
-- files and statuses are keyed on due_date, and stay keyed on the day the
-- schedule put it on, wherever it now sits. Only where it shows changes.
--
-- Only the owner moves work. The person it belongs to can see where their
-- work went, but not push it back.
--
-- Safe to run twice.
-- ============================================================================

create table if not exists public.task_moves (
  task_id     uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.users(id) on delete cascade,
  -- The day the schedule put it on: the occurrence's identity.
  due_date    date not null,
  -- The day it now shows on.
  moved_to    date not null,
  moved_by    uuid references public.users(id) on delete set null,
  moved_at    timestamptz not null default now(),
  primary key (task_id, employee_id, due_date)
);

alter table public.task_moves enable row level security;

drop policy if exists task_moves_select on public.task_moves;
create policy task_moves_select on public.task_moves
  for select to authenticated
  using (public.is_owner() or employee_id = auth.uid());

drop policy if exists task_moves_write on public.task_moves;
create policy task_moves_write on public.task_moves
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Live: the employee's My Tasks and calendar update the moment the owner
-- drops the block, without a reload. Realtime applies RLS per subscriber.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'task_moves'
  ) then
    alter publication supabase_realtime add table public.task_moves;
  end if;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not found; moves will show after a reload';
end $$;
