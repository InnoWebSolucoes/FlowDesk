-- ============================================================================
-- "Missed" as a status somebody can set on a task.
--
-- A task that nothing has happened to moves forward to the next day at
-- midnight, and keeps moving until something does. Marking it missed is how
-- an employee says "this one is not coming with me": it stops on the day it
-- was marked and never moves again.
--
-- It lives in task_statuses beside "in progress". They share the one row per
-- occurrence, so a task is started or missed, never both, and marking one
-- replaces the other. started_at is when the current status was set — the
-- moment of starting, or of marking missed — which is the day it stops on.
--
-- Two checks are in the way. task_statuses.status allowed only 'in_progress',
-- and activity_logs.action has a fixed list that did not include 'missed'.
--
-- The action list is extended in place rather than restated. If anything since
-- the initial schema added actions to it, restating the original list here
-- would quietly remove them and break whatever writes them. So the current
-- definition is read back and 'missed' is added to it.
--
-- Safe to run twice.
-- ============================================================================

do $missed$
declare
  c record;
  def text;
begin
  -- ─── task_statuses.status ────────────────────────────────────────────────
  -- One value ever existed, so this is restated outright.
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'task_statuses'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.task_statuses drop constraint %I', c.conname);
  end loop;

  alter table public.task_statuses
    add constraint task_statuses_status_check
    check (status in ('in_progress', 'missed'));

  -- ─── activity_logs.action ────────────────────────────────────────────────
  -- Postgres stores `action in (...)` as `action = ANY (ARRAY[...])`, so
  -- 'missed' goes in just before the closing bracket of whatever is there.
  for c in
    select con.oid, con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'activity_logs'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%action%'
  loop
    def := pg_get_constraintdef(c.oid);
    if def ilike '%''missed''%' then
      continue;
    end if;
    if position(']' in def) = 0 then
      continue;
    end if;
    execute format('alter table public.activity_logs drop constraint %I', c.conname);
    execute format(
      'alter table public.activity_logs add constraint %I %s',
      c.conname,
      overlay(def placing ', ''missed''::text]' from position(']' in def) for 1)
    );
  end loop;
end
$missed$;

comment on column public.task_statuses.started_at is
  'When the current status was set: started, or marked missed. The day a task stops moving on.';


-- ─── What is allowed now ────────────────────────────────────────────────────
-- Expect both rows to mention 'missed'.

select rel.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and con.contype = 'c'
  and (
    (rel.relname = 'task_statuses' and pg_get_constraintdef(con.oid) ilike '%status%')
    or (rel.relname = 'activity_logs' and pg_get_constraintdef(con.oid) ilike '%action%')
  )
order by 1;
