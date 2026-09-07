-- ============================================================================
-- Why a document sent in chat does not open for the person receiving it.
--
-- The message arrives, but the attachment resolves to nothing, so the chip
-- renders as unavailable. The recipient reads the document through
-- resource_items_select, which since 20260915000000 gates on in_project() —
-- membership — rather than on my_project_id(), the single primary project.
-- If that migration never ran here, the old rule is still live and anyone
-- whose primary project is not the document's cannot see it.
--
-- Read-only. Run it and send back all four result sets.
-- ============================================================================

-- ─── 1. Is the fix actually installed? ──────────────────────────────────────
-- The live policy should mention in_project. If it says my_project_id, the
-- migration never ran on this database.

select policyname, cmd, qual as using_expression
from pg_policies
where schemaname = 'public'
  and tablename in ('resource_items', 'resource_clusters')
  and cmd = 'SELECT'
order by tablename;


-- ─── 2. Does in_project() even exist here? ──────────────────────────────────
-- Empty means 20260915000000 was never applied.

select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('in_project', 'item_clusters_allow', 'cluster_chain_allows');


-- ─── 3. The documents sent in chat, and whether Esmael can reach them ───────
-- access, the clusters they sit in, and whether those clusters would let him
-- through.

select
  i.id,
  i.title,
  i.access,
  i.project_id,
  (select count(*) from resource_item_clusters ic where ic.item_id = i.id) as in_clusters,
  (select string_agg(c.title || ' (' || c.access || ')', ', ')
     from resource_item_clusters ic
     join resource_clusters c on c.id = ic.cluster_id
    where ic.item_id = i.id) as clusters
from resource_items i
where exists (select 1 from chat_message_items cmi where cmi.item_id = i.id)
order by i.created_at desc
limit 20;


-- ─── 4. Esmael's membership ─────────────────────────────────────────────────
-- in_project passes on a project_members row, or on the legacy users.project_id.

select
  u.id,
  u.name,
  u.project_id as legacy_project_id,
  (select string_agg(p.name, ', ')
     from project_members m join projects p on p.id = m.project_id
    where m.user_id = u.id) as member_of
from users u
order by u.role, u.name;
