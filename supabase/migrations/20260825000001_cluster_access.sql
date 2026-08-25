-- Access on a cluster, inherited by everything inside it.
--
-- A cluster carries the same four levels as a document. Restricting a cluster
-- hides the bubble itself and, because access is inherited, every nested
-- cluster and every document tagged into any of them.
--
-- Inheritance is restrictive: a document is visible only if its own access
-- allows it AND every cluster it sits inside allows it. Opening up a document
-- inside a managers-only cluster does not leak it, which is the behaviour
-- anyone setting a cluster to "managers only" is relying on.

alter table public.resource_clusters
  add column if not exists access text not null default 'everyone'
    check (access in ('everyone', 'managers', 'employees', 'specific'));

create table if not exists public.resource_cluster_access (
  cluster_id uuid not null references public.resource_clusters(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (cluster_id, user_id)
);

create index if not exists resource_cluster_access_user_idx on public.resource_cluster_access(user_id);

alter table public.resource_cluster_access enable row level security;

create policy "resource_cluster_access_select" on public.resource_cluster_access for select to authenticated using (
  user_id = auth.uid() or public.is_admin()
);
create policy "resource_cluster_access_write_admin" on public.resource_cluster_access for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─── Can the caller see one cluster, ignoring its ancestors? ────────────────

create or replace function public.cluster_access_allows(cluster uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.resource_clusters c
    where c.id = cluster
      and (
        c.access in ('everyone', 'employees')
        or (
          c.access = 'specific'
          and exists (
            select 1 from public.resource_cluster_access a
            where a.cluster_id = c.id and a.user_id = auth.uid()
          )
        )
      )
  );
$$;

-- ─── …and every cluster above it? ──────────────────────────────────────────
-- Walks up the parent chain. The depth guard stops a cycle from a bad write
-- turning this into an infinite loop.

create or replace function public.cluster_chain_allows(cluster uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  current uuid := cluster;
  depth int := 0;
begin
  while current is not null and depth < 64 loop
    if not public.cluster_access_allows(current) then
      return false;
    end if;
    select parent_cluster_id into current from public.resource_clusters where id = current;
    depth := depth + 1;
  end loop;
  return true;
end;
$$;

-- ─── Clusters ───────────────────────────────────────────────────────────────

drop policy if exists "resource_clusters_select" on public.resource_clusters;

create policy "resource_clusters_select" on public.resource_clusters for select to authenticated using (
  public.is_admin()
  or (project_id = public.my_project_id() and public.cluster_chain_allows(id))
);

-- ─── Documents: their own access, and every cluster they sit in ────────────

create or replace function public.item_clusters_allow(item uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  -- A document in no cluster has nothing to inherit from.
  select not exists (
    select 1 from public.resource_item_clusters ic
    where ic.item_id = item
      and not public.cluster_chain_allows(ic.cluster_id)
  );
$$;

drop policy if exists "resource_items_select" on public.resource_items;

create policy "resource_items_select" on public.resource_items for select to authenticated using (
  public.is_admin()
  or (
    project_id = public.my_project_id()
    and (
      access = 'everyone'
      or access = 'employees'
      or (access = 'specific' and public.can_access_resource_item(id))
    )
    and public.item_clusters_allow(id)
  )
);

-- ─── The files themselves ──────────────────────────────────────────────────

drop policy if exists "attachments_select_resources" on storage.objects;

create policy "attachments_select_resources" on storage.objects for select to authenticated using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = 'resources'
  and (
    public.is_admin()
    or exists (
      select 1 from public.resource_items ri
      where ri.storage_path = storage.objects.name
        and ri.project_id = public.my_project_id()
        and (
          ri.access = 'everyone'
          or ri.access = 'employees'
          or (ri.access = 'specific' and public.can_access_resource_item(ri.id))
        )
        and public.item_clusters_allow(ri.id)
    )
    or exists (
      select 1
      from public.resource_item_versions v
      join public.resource_items ri on ri.id = v.item_id
      where v.storage_path = storage.objects.name
        and ri.project_id = public.my_project_id()
        and (
          ri.access = 'everyone'
          or ri.access = 'employees'
          or (ri.access = 'specific' and public.can_access_resource_item(ri.id))
        )
        and public.item_clusters_allow(ri.id)
    )
  )
);
