-- Who can see a document.
--
-- Until now every employee on a project could read every document in it. A
-- document now carries an access level, and optionally a list of named people:
--
--   everyone  (default) — anyone on the project, as before
--   managers            — admins only
--   employees           — admins plus employees on the project, which is the
--                         same as everyone today but stays correct if other
--                         roles are added later
--   specific            — admins plus the people named in resource_item_access
--
-- Managers always retain access: they are responsible for the project's files
-- and must not be able to lock themselves out of one.

alter table public.resource_items
  add column if not exists access text not null default 'everyone'
    check (access in ('everyone', 'managers', 'employees', 'specific'));

create table if not exists public.resource_item_access (
  item_id uuid not null references public.resource_items(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (item_id, user_id)
);

create index if not exists resource_item_access_user_idx on public.resource_item_access(user_id);

alter table public.resource_item_access enable row level security;

-- Reading the list: the people named on it, and admins who manage it.
create policy "resource_item_access_select" on public.resource_item_access for select to authenticated using (
  user_id = auth.uid() or public.is_admin()
);

create policy "resource_item_access_write_admin" on public.resource_item_access for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Named in the list? Answered in a definer function so the policy below does
-- not re-enter this table's own RLS.
create or replace function public.can_access_resource_item(item uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.resource_item_access a
    where a.item_id = item and a.user_id = auth.uid()
  );
$$;

-- ─── Apply the access level to reads ────────────────────────────────────────

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
  )
);

-- ─── And to the files themselves ────────────────────────────────────────────
-- Without this an employee who cannot see a document's row could still fetch
-- its bytes by holding on to the storage path.

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
    )
    -- Archived versions follow their document's access.
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
    )
  )
);
