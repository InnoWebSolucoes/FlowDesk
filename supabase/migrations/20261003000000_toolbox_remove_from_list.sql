-- ============================================================================
-- Taking a website off one person's Toolbox without deleting it for others.
--
-- A site can be on several people's lists. Removing it from yours should take
-- it off yours — not delete it for everyone else who has it.
--
-- The client cannot decide that safely. An employee's RLS only lets them see
-- their own assignment, so from their side every site looks like it is theirs
-- alone, and "delete the site if nobody else has it" would always delete it.
-- This function can see every assignment, so it decides:
--   1. take it off this person's list;
--   2. if nobody has it any more, delete the site itself, so no orphan is left.
--
-- Allowed for the owner, on anyone's list, and for anyone on their own.
-- Safe to run twice.
-- ============================================================================

create or replace function public.remove_website_from_list(p_website uuid, p_employee uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.is_owner() or p_employee = auth.uid()) then
    raise exception 'Not allowed to change that list';
  end if;

  delete from public.website_assignments
  where website_id = p_website and employee_id = p_employee;

  if not exists (select 1 from public.website_assignments where website_id = p_website) then
    delete from public.websites where id = p_website;
  end if;
end;
$$;

revoke all on function public.remove_website_from_list(uuid, uuid) from public;
grant execute on function public.remove_website_from_list(uuid, uuid) to authenticated;
