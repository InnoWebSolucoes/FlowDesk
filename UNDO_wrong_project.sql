-- ============================================================================
-- Undo: FlowDesk migrations run against the wrong database.
--
-- Run this in the OTHER project — the unrelated one — not in FlowDesk.
--
-- It reports first and removes second, and it only removes things whose names
-- belong to FlowDesk. Anything that was already in that database is untouched:
-- there is no drop of a table, no delete of a row, and nothing that could
-- affect data you care about.
-- ============================================================================

-- ─── 1. What is actually there ──────────────────────────────────────────────
-- Run this on its own first and read it. If the second half's list is empty,
-- nothing was created and there is nothing to undo.

select 'function' as kind, p.proname as name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'ensure_conversation_cluster',
    'notify_work_logged'
  )

union all

select 'table', c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('work_log_entries', 'work_log_items')

union all

select 'column', 'conversations.' || a.attname
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'conversations'
  and a.attname in ('resolved_at', 'resolved_by')
  and not a.attisdropped

order by kind, name;


-- ─── 2. Remove them ─────────────────────────────────────────────────────────
-- Everything below is guarded, so it is a no-op for anything that was never
-- created. Run it once the list above looks like only FlowDesk's own names.

-- The function you ran. Dropping it is safe: it references conversations,
-- tasks and resource_clusters, so in a database without those it could never
-- have been called successfully by anything.
drop function if exists public.ensure_conversation_cluster(uuid, text);

-- These only exist if the work log ran there too. Its own tables, nothing
-- shared: dropping them cannot reach anything that was already present.
drop table if exists work_log_items;
drop table if exists work_log_entries;
drop function if exists public.notify_work_logged();

-- The resolve-threads columns, if that one applied. Only these two columns are
-- touched; the conversations table itself and every other column stay.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations'
      and column_name = 'resolved_at'
  ) then
    execute 'drop index if exists conversations_resolved_idx';
    execute 'alter table conversations drop column if exists resolved_at';
    execute 'alter table conversations drop column if exists resolved_by';
  end if;
end $$;


-- ─── 3. Confirm ─────────────────────────────────────────────────────────────
-- Should come back with no rows.

select 'function' as kind, p.proname as name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ensure_conversation_cluster', 'notify_work_logged')

union all

select 'table', c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('work_log_entries', 'work_log_items');
