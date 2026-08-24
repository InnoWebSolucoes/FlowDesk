-- Every item's home cluster must also be a row in resource_item_clusters —
-- the canvas and folder views both read clusterIds exclusively, so a home
-- without a matching tag row makes the item invisible inside its own
-- cluster (no card, no pull-out preview) even though it still counts toward
-- the cluster's badge. The original backfill in versions_and_tags.sql only
-- ran once at migration time; anything homed into a cluster afterward
-- without going through the tag table stays orphaned. Re-run it here for
-- whatever's missing now.
insert into public.resource_item_clusters (item_id, cluster_id)
select id, cluster_id from public.resource_items where cluster_id is not null
on conflict do nothing;
