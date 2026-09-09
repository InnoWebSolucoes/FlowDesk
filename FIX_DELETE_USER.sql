-- ============================================================================
-- "Database error deleting user".
--
-- The permission fix worked — the function got past the owner check and the
-- delete itself was refused by Postgres.
--
-- Sixteen foreign keys point at public.users(id) with no ON DELETE action.
-- The default is RESTRICT, so one task the person created, one comment they
-- wrote, one file they uploaded is enough to block the delete. Deleting the
-- auth user cascades to public.users, and that cascade then runs into these.
--
-- This rewrites every one of them, choosing per column rather than in bulk:
--
--   nullable  -> ON DELETE SET NULL. "Created by" on a task that still
--                matters becomes nobody; the task stays.
--   not null  -> ON DELETE CASCADE. The row cannot exist without the person,
--                so it goes with them — a comment they wrote, a file they
--                uploaded, an activity log entry about them.
--
-- Section 1 lists what will change before anything is changed. Read it, then
-- run section 2.
-- ============================================================================


-- ─── 1. What is blocking the delete ─────────────────────────────────────────
-- Every FK to users with no delete rule, and what this script will make it.
-- "cascade" means rows in that table go when the person goes.

select
  c.conrelid::regclass::text                         as table_name,
  a.attname                                          as column_name,
  a.attnotnull                                       as is_required,
  case when a.attnotnull then 'cascade' else 'set null' end as will_become
from pg_constraint c
join pg_attribute a
  on a.attrelid = c.conrelid
 and a.attnum = c.conkey[1]
where c.contype = 'f'
  and c.confrelid = 'public.users'::regclass
  -- 'a' is no action and 'r' is an explicit restrict; both refuse the
  -- delete, and only these two need rewriting.
  and c.confdeltype in ('a', 'r')
  and array_length(c.conkey, 1) = 1
order by 1, 2;


-- ─── 2. Rewrite them ────────────────────────────────────────────────────────
-- Each constraint is dropped and recreated with a delete rule. Single-column
-- keys only: a composite FK to users would need thought rather than a loop,
-- and there are none.

do $fix$
declare
  r record;
  action text;
begin
  for r in
    select
      c.conname,
      c.conrelid::regclass::text as tbl,
      a.attname                  as col,
      a.attnotnull               as required
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.users'::regclass
      and c.confdeltype in ('a', 'r')
      and array_length(c.conkey, 1) = 1
  loop
    action := case when r.required then 'cascade' else 'set null' end;

    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references public.users(id) on delete %s',
      r.tbl, r.conname, r.col, action
    );

    raise notice '% . % -> on delete %', r.tbl, r.col, action;
  end loop;
end
$fix$;


-- ─── 3. Confirm ─────────────────────────────────────────────────────────────
-- Nothing should come back: every FK to users now has a delete rule, so
-- removing somebody no longer runs into one.

select
  c.conrelid::regclass::text as still_blocking,
  a.attname                  as column_name
from pg_constraint c
join pg_attribute a
  on a.attrelid = c.conrelid
 and a.attnum = c.conkey[1]
where c.contype = 'f'
  and c.confrelid = 'public.users'::regclass
  and c.confdeltype in ('a', 'r')
order by 1, 2;
