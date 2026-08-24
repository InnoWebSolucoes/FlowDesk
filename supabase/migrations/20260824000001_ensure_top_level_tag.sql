-- 20260823000003_top_level_tag.sql never reached the deployed database, so
-- resource_items still lacks show_at_top_level. Every insert from the app
-- writes that column, which made all uploads fail with PGRST204. Re-apply it
-- idempotently rather than editing the original, which may already have run
-- elsewhere.

alter table public.resource_items
  add column if not exists show_at_top_level boolean not null default false;

-- Backfill: an item with no home cluster lives in the main space. Keyed on
-- cluster_id rather than the tag table, because by now every home is also a
-- tag — testing the tag table would leave genuinely top-level items hidden.
update public.resource_items
set show_at_top_level = true
where cluster_id is null
  and show_at_top_level = false;
