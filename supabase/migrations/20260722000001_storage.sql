-- Storage bucket for documents and task attachments.
-- Run this after 20260722000000_initial_schema.sql.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Path convention (only segments 1 and 2 are enforced by policy, the rest is free-form):
--   documents/{employeeId}/{documentId}-{filename}
--   task-attachments/{taskId}/{attachmentId}-{filename}

create policy "attachments_select" on storage.objects for select to authenticated using (
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

create policy "attachments_insert" on storage.objects for insert to authenticated with check (
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

create policy "attachments_delete" on storage.objects for delete to authenticated using (
  bucket_id = 'attachments' and (
    public.is_admin()
    or (storage.foldername(name))[1] = 'documents' and (storage.foldername(name))[2] = auth.uid()::text
  )
);
