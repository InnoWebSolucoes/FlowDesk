-- Documents and clusters attached to a calendar entry, mirroring
-- project_todo_links. Lets a meeting carry its agenda, a work block carry the
-- file being worked on, and lets the calendar and the resources tab cross-link.

create table if not exists public.calendar_entry_links (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.calendar_entries(id) on delete cascade,
  item_id uuid references public.resource_items(id) on delete cascade,
  cluster_id uuid references public.resource_clusters(id) on delete cascade,
  constraint calendar_entry_link_target check (num_nonnulls(item_id, cluster_id) = 1)
);

create index if not exists calendar_entry_links_entry_idx on public.calendar_entry_links(entry_id);

alter table public.calendar_entry_links enable row level security;

-- Readable and writable by whoever can read and write the entry itself.
create policy "calendar_entry_links_select" on public.calendar_entry_links for select to authenticated using (
  exists (select 1 from public.calendar_entries e where e.id = calendar_entry_links.entry_id)
);

create policy "calendar_entry_links_write" on public.calendar_entry_links for all to authenticated
  using (
    exists (
      select 1 from public.calendar_entries e
      where e.id = calendar_entry_links.entry_id
        and (e.owner_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.calendar_entries e
      where e.id = calendar_entry_links.entry_id
        and (e.owner_id = auth.uid() or public.is_admin())
    )
  );
