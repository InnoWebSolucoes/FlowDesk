-- A document sent in a direct message had nowhere to be filed.
--
-- ensure_conversation_cluster takes the project from the conversation, and a
-- direct room has none: project_id is null and there is no task to borrow one
-- from. The function returned null, the upload was refused, and the sender was
-- told the document could not be filed — for every direct chat, always.
--
-- A direct room belongs to the project the two people share. Falling back to
-- the sender's own project is enough: they are filing the document, and it is
-- their project it lands in.

create or replace function public.ensure_conversation_cluster(conv uuid, folder_title text)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  existing uuid;
  proj uuid;
  parent uuid;
  made uuid;
begin
  if not public.can_see_conversation(conv) then
    raise exception 'not a member of this conversation';
  end if;

  select cluster_id, project_id into existing, proj from public.conversations where id = conv;
  if existing is not null then
    return existing;
  end if;

  -- A task room has no project of its own; take it from the task.
  if proj is null then
    select t.project_id into proj
    from public.conversations c join public.tasks t on t.id = c.task_id
    where c.id = conv;
  end if;

  -- A direct room has neither. It belongs wherever the person filing the
  -- document works — their primary project, or any project they are on.
  if proj is null then
    select u.project_id into proj from public.users u where u.id = auth.uid();
  end if;
  if proj is null then
    select pm.project_id into proj
    from public.project_members pm
    where pm.user_id = auth.uid()
    order by pm.added_at
    limit 1;
  end if;

  if proj is null then
    return null;
  end if;

  -- Every chat folder hangs under one "Chat" bubble, so rooms do not scatter
  -- across the canvas.
  select id into parent from public.resource_clusters
  where project_id = proj and parent_cluster_id is null and title = 'Chat'
  limit 1;

  if parent is null then
    insert into public.resource_clusters (project_id, parent_cluster_id, title, color, x, y, radius)
    values (proj, null, 'Chat', '#25d366', 0, 0, 160)
    returning id into parent;
  end if;

  insert into public.resource_clusters (project_id, parent_cluster_id, title, color, x, y, radius)
  values (proj, parent, coalesce(nullif(folder_title, ''), 'Conversation'), '#25d366', 0, 0, 120)
  returning id into made;

  update public.conversations set cluster_id = made where id = conv;
  return made;
end;
$fn$;

grant execute on function public.ensure_conversation_cluster(uuid, text) to authenticated;
