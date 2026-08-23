-- Two additions to resources:
--   1. Document versions — a stack of file iterations under one item, so past
--      versions stay reachable and any of them can be made current.
--   2. Multi-cluster tagging — one document can appear in several clusters
--      without being duplicated.

-- ─── Versions ───────────────────────────────────────────────────────────────

create table public.resource_item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.resource_items(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size int,
  label text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

create index resource_item_versions_item_idx on public.resource_item_versions(item_id, created_at desc);

-- Backfill: an item that already has a file gets that file as version 1, so
-- existing documents start with a coherent history rather than an empty one.
insert into public.resource_item_versions (item_id, storage_path, file_name, mime_type, size, created_at, created_by)
select id, storage_path, coalesce(file_name, 'file'), mime_type, size, created_at, created_by
from public.resource_items
where storage_path is not null;

-- ─── Multi-cluster tags ─────────────────────────────────────────────────────

-- resource_items.cluster_id stays as the item's home (where it was created and
-- where it sits on the canvas). Tags are additional clusters it also shows in.
create table public.resource_item_clusters (
  item_id uuid not null references public.resource_items(id) on delete cascade,
  cluster_id uuid not null references public.resource_clusters(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, cluster_id)
);

create index resource_item_clusters_cluster_idx on public.resource_item_clusters(cluster_id);

-- Backfill: every item's current cluster becomes its first tag, so the tag
-- table alone describes where a document appears.
insert into public.resource_item_clusters (item_id, cluster_id)
select id, cluster_id from public.resource_items where cluster_id is not null
on conflict do nothing;

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.resource_item_versions enable row level security;
alter table public.resource_item_clusters enable row level security;

-- Both mirror resource_items: employees read their own project, admins write.
create policy "resource_item_versions_select" on public.resource_item_versions for select to authenticated using (
  exists (
    select 1 from public.resource_items ri
    where ri.id = resource_item_versions.item_id
      and (is_admin() or ri.project_id = my_project_id())
  )
);
create policy "resource_item_versions_write_admin" on public.resource_item_versions for all to authenticated using (is_admin()) with check (is_admin());

create policy "resource_item_clusters_select" on public.resource_item_clusters for select to authenticated using (
  exists (
    select 1 from public.resource_items ri
    where ri.id = resource_item_clusters.item_id
      and (is_admin() or ri.project_id = my_project_id())
  )
);
create policy "resource_item_clusters_write_admin" on public.resource_item_clusters for all to authenticated using (is_admin()) with check (is_admin());
