-- ============================================================================
-- When somebody started a task, not just that they did.
--
-- task_statuses recorded the fact of "in progress" and nothing else, so a
-- manager looking at a task could see it had been started but not whether
-- that was ten minutes ago or last Tuesday — which is the part that tells you
-- whether it is moving.
--
-- Defaults to now() for rows that already exist. That is a guess, and a
-- generous one: anything started before this migration will read as having
-- begun the moment the migration ran. It settles itself as work is started
-- afresh, and there is nothing better available — the moment was never
-- recorded, so it cannot be recovered.
-- ============================================================================

alter table public.task_statuses
  add column if not exists started_at timestamptz not null default now();
