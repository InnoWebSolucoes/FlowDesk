-- ============================================================================
-- Nothing belongs to nobody.
--
-- Work is either an employee's or InnoWeb's. Todos created since
-- 20260919000000 always record who added them, but rows written before that
-- can still have no assignee, no owner and no creator — nothing at all
-- saying whose they are. On the calendar those were drawn in a third colour
-- meaning "unassigned", which is now gone: the colours say employee or
-- InnoWeb, and there is no third thing for an ownerless row to be.
--
-- They sit on the shared manager board, so InnoWeb is who they belong to.
-- ============================================================================

update public.project_todos
set created_by = '1e2001c5-72b2-44a6-9605-9954db51908e'
where created_by is null
  and owner_id is null
  and assignee_id is null;

-- The column default and the trigger from 20260919000000 keep new rows
-- covered, so this only ever has to run once. Kept as a constraint rather
-- than trusting that: a row with nothing on it saying whose it is cannot be
-- drawn correctly, so it should not be storable.
alter table public.project_todos
  drop constraint if exists project_todos_has_an_owner;

alter table public.project_todos
  add constraint project_todos_has_an_owner
  check (num_nonnulls(assignee_id, owner_id, created_by) > 0)
  not valid;

-- not valid checks new and updated rows but does not rescan the table, then
-- validate confirms what is already there. Split so that if anything was
-- missed above the validation fails loudly instead of the whole migration
-- refusing to apply.
alter table public.project_todos
  validate constraint project_todos_has_an_owner;


-- ─── Confirm ────────────────────────────────────────────────────────────────
-- belonging_to_nobody must be 0.

select
  count(*) as total,
  count(*) filter (
    where assignee_id is null and owner_id is null and created_by is null
  ) as belonging_to_nobody
from public.project_todos;
