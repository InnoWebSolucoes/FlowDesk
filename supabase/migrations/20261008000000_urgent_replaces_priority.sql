-- ============================================================================
-- Priority goes; urgent replaces it.
--
-- Low, medium and high are no longer a thing: every task and todo is equal,
-- except the ones marked urgent, which are highlighted and sorted to the top.
--
-- Everything starts not urgent — an old "high" is not carried over, because
-- the point is that almost nothing is urgent.
--
-- The priority columns are left in place so an older app build still reads
-- and writes them without failing. tasks.priority had no default, so it gets
-- one: the app stops sending it.
-- ============================================================================

alter table public.tasks
  add column if not exists is_urgent boolean not null default false;

alter table public.project_todos
  add column if not exists is_urgent boolean not null default false;

alter table public.tasks
  alter column priority set default 'medium';

-- PostgREST caches the schema; without this the new columns 400 until it
-- happens to reload.
notify pgrst, 'reload schema';
