-- Make the main space an explicit destination rather than "has no tags", so a
-- document can sit at the top level *and* inside clusters at the same time.

alter table public.resource_items
  add column show_at_top_level boolean not null default false;

-- Backfill: anything that had no cluster tags was showing at the top level
-- under the old implicit rule, so keep it there.
update public.resource_items ri
set show_at_top_level = true
where not exists (
  select 1 from public.resource_item_clusters ric where ric.item_id = ri.id
);
