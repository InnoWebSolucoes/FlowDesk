-- Overwriting a stored file (upsert) is an UPDATE on storage.objects, and no
-- UPDATE policy existed — only select/insert/delete. So every re-upload of an
-- existing path failed with "new row violates row-level security policy":
-- replacing a document's file, saving a new version, and the desktop folder
-- sync re-uploading a file that changed on disk.
--
-- Mirrors the existing insert policies exactly: admins for resources, and
-- owners for their own documents/task attachments.

create policy "attachments_update" on storage.objects for update to authenticated
using (
  bucket_id = 'attachments' and (
    public.is_admin()
    or (storage.foldername(name))[1] = 'documents' and (storage.foldername(name))[2] = auth.uid()::text
    or (
      (storage.foldername(name))[1] = 'task-attachments'
      and exists (
        select 1 from public.task_assignments ta
        where ta.task_id = ((storage.foldername(name))[2])::uuid
          and ta.employee_id = auth.uid()
      )
    )
  )
)
with check (
  bucket_id = 'attachments' and (
    public.is_admin()
    or (storage.foldername(name))[1] = 'documents' and (storage.foldername(name))[2] = auth.uid()::text
    or (
      (storage.foldername(name))[1] = 'task-attachments'
      and exists (
        select 1 from public.task_assignments ta
        where ta.task_id = ((storage.foldername(name))[2])::uuid
          and ta.employee_id = auth.uid()
      )
    )
  )
);
