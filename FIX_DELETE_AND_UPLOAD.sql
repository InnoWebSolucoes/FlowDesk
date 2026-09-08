-- ============================================================================
-- Deleting an employee and uploading a resource both failing.
--
-- Two different causes that look the same from the app.
--
-- 1. DELETE goes through the delete-employee edge function, which requires
--    the caller's users.role to be exactly 'admin'. The owner-only migration
--    set every account except InnoWeb to role = 'employee'. So this works
--    only when signed in as innowebsolucoes@gmail.com — and the generic
--    "Edge Function returned a non-2xx status code" is what a 403 looks like
--    once supabase-js has thrown the body away.
--
-- 2. UPLOAD is storage, not a function. Its two policies are:
--       attachments_insert_resources           ... is_admin()
--       attachments_insert_resources_employee  ... folder = my_project_id()
--    is_admin() is now is_owner(), so the first passes only for the owner.
--    The second reads users.project_id — the legacy single-project column,
--    which the owner-only migration never populated, so it is null and the
--    check fails for everybody else.
--
-- Section 1 shows which of these applies. Section 2 fixes the upload for
-- everyone by gating on real membership instead of the legacy column.
-- ============================================================================


-- ─── 1. Who is who, and what they can do ────────────────────────────────────
-- can_delete: the edge function's test — role must be exactly 'admin'.
-- legacy_project_id: what the old storage policy reads. Null is the problem.
-- memberships: real membership, which is what should be gating uploads.

select
  u.name,
  u.email,
  u.role,
  u.is_owner,
  (u.role = 'admin')  as can_delete_employees,
  u.project_id        as legacy_project_id,
  (select count(*) from public.project_members m where m.user_id = u.id) as memberships
from public.users u
order by u.is_owner desc, u.name;


-- ─── 2. Uploads: gate on membership, not the legacy column ──────────────────
-- resources/{projectId}/… — the project segment is what decides, and whether
-- the person is on that project is a project_members question. The legacy
-- users.project_id names only one project and is no longer maintained.

drop policy if exists "attachments_insert_resources"           on storage.objects;
drop policy if exists "attachments_insert_resources_employee"  on storage.objects;
drop policy if exists "attachments_update_resources_employee"  on storage.objects;
drop policy if exists "attachments_delete_resources"           on storage.objects;

-- Uploading into a project you are on, or anywhere if you are the owner.
create policy "attachments_insert_resources" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'resources'
    and (
      public.is_owner()
      or exists (
        select 1 from public.project_members m
        where m.user_id = auth.uid()
          and m.project_id::text = (storage.foldername(name))[2]
      )
    )
  );

-- Replacing a file at a path that already exists is an UPDATE, not an insert.
create policy "attachments_update_resources" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'resources'
    and (
      public.is_owner()
      or exists (
        select 1 from public.project_members m
        where m.user_id = auth.uid()
          and m.project_id::text = (storage.foldername(name))[2]
      )
    )
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'resources'
    and (
      public.is_owner()
      or exists (
        select 1 from public.project_members m
        where m.user_id = auth.uid()
          and m.project_id::text = (storage.foldername(name))[2]
      )
    )
  );

-- Deleting a resource file stays with the owner: removing somebody else's
-- upload is not something an employee should be able to do by accident.
create policy "attachments_delete_resources" on storage.objects
  for delete to authenticated using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'resources'
    and public.is_owner()
  );


-- ─── 3. Backfill the legacy column anyway ───────────────────────────────────
-- Nothing above needs it now, but other policies written before
-- project_members existed still read my_project_id(), and they fail the same
-- way. Set it to a project each person is actually on.

update public.users u
set project_id = (
  select m.project_id
  from public.project_members m
  where m.user_id = u.id
  order by m.project_id
  limit 1
)
where u.project_id is null
  and exists (select 1 from public.project_members m where m.user_id = u.id);


-- ─── 4. Confirm ─────────────────────────────────────────────────────────────
-- Every account should now have a legacy_project_id, and the resource
-- policies should be the four above.

select
  u.name,
  u.email,
  u.role,
  u.is_owner,
  u.project_id as legacy_project_id,
  (select count(*) from public.project_members m where m.user_id = u.id) as memberships
from public.users u
order by u.is_owner desc, u.name;

select policyname, cmd
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like '%resources%'
order by cmd, policyname;
