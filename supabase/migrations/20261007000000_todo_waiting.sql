-- ============================================================================
-- "Waiting" on the managers' to-do list.
--
-- A manager's to-do is often not open and not done: our part is finished and
-- it is sitting with somebody else. The checkbox on the shared manager board
-- now goes open → waiting (a clock) → completed, and right-clicking it picks
-- any of the three.
--
-- One nullable timestamp says it: set while waiting, null otherwise. When it
-- was set is kept because "waiting since Tuesday" is the useful half of
-- "waiting". Completing or reopening a todo clears it.
--
-- Employees' own lists do not use it.
--
-- Safe to run twice.
-- ============================================================================

alter table public.project_todos
  add column if not exists waiting_since timestamptz;
