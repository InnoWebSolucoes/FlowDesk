-- Sharing a cluster without overriding what is inside it.
--
-- Cluster access is inherited restrictively: a document is visible only if its
-- own access allows it AND every cluster it sits in allows it. That is the
-- right default — setting a cluster to "managers only" must not be undone by
-- one permissive document inside it.
--
-- But it makes the opposite intent impossible to express: "let this person
-- into the cluster, and they see whatever their own access already entitles
-- them to". Under the old model, opening the cluster to someone was the only
-- way to let them in, and it opened the cluster for everything.
--
--   relative — the named people may enter the cluster; each document inside is
--              then judged on its own access, exactly as it would be anywhere
--              else. Entry, not a blanket grant.
--
-- The existing levels are unchanged.

alter table public.resource_clusters
  drop constraint if exists resource_clusters_access_check;

alter table public.resource_clusters
  add constraint resource_clusters_access_check check (access in (
    'everyone',
    'managers',
    'employees',
    'specific',
    'relative'
  ));

-- A cluster the caller may enter. 'relative' behaves like 'specific' for the
-- purpose of getting in; the difference is entirely in what happens to the
-- documents once inside, which is handled by item_clusters_allow below.
create or replace function public.cluster_access_allows(cluster uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.resource_clusters c
    where c.id = cluster
      and (
        c.access in ('everyone', 'employees')
        or (
          c.access in ('specific', 'relative')
          and exists (
            select 1 from public.resource_cluster_access a
            where a.cluster_id = c.id and a.user_id = auth.uid()
          )
        )
      )
  );
$fn$;

-- Does every cluster this document sits in allow it through?
--
-- A 'relative' cluster deliberately does not gate its contents beyond letting
-- you in: the document's own access decides, which is the whole point of the
-- level. Every other level keeps inheriting restrictively as before.
create or replace function public.item_clusters_allow(item uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select not exists (
    select 1
    from public.resource_item_clusters ic
    join public.resource_clusters c on c.id = ic.cluster_id
    where ic.item_id = item
      and c.access <> 'relative'
      and not public.cluster_chain_allows(ic.cluster_id)
  );
$fn$;
