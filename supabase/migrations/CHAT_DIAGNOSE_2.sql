-- ============================================================================
-- FlowDesk — chat insert diagnosis.
--
-- The policies are clean and PERMISSIVE, and the client demonstrably sends
-- created_by = the signed-in user's id. The insert is still refused, so the
-- remaining question is what the database sees when it evaluates
-- created_by = auth.uid().
--
-- Run this in the Supabase SQL editor WHILE SIGNED IN AS YOURSELF is not
-- possible — the SQL editor runs as the postgres superuser, where auth.uid()
-- is null. That is expected and is not the bug. What this file does instead is
-- prove the policy logic is sound by testing it as a real user id.
--
-- Run the whole file and send back what the last query prints.
-- ============================================================================

-- 1. Who exists, and are these the ids the app is using?
select id, email, name, role from public.users order by role, name;


-- 2. Prove the insert works when auth.uid() matches created_by.
--
--    request.jwt.claims is what auth.uid() reads. Setting it here impersonates
--    that user for the rest of the transaction, which is exactly the condition
--    the app is in. If this INSERT succeeds, the policy is correct and the
--    problem is that the app's requests are arriving WITHOUT a valid token —
--    auth.uid() null — rather than with the wrong one.
--
--    It rolls back, so nothing is left behind.

do $$
declare
  victim uuid;
  other  uuid;
  made   uuid;
begin
  select id into victim from public.users where role = 'admin' limit 1;
  select id into other  from public.users where id <> victim  limit 1;

  if victim is null or other is null then
    raise notice 'STOP: need at least two users to test with';
    return;
  end if;

  -- Become that user, the way a request with their token would be.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', victim::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);

  raise notice 'acting as % (auth.uid() = %)', victim, auth.uid();

  insert into public.conversations (kind, pair_key, created_by)
  values ('direct', 'diagnose:' || victim || ':' || other, victim)
  returning id into made;

  raise notice 'INSERT SUCCEEDED, id = %  -> the policy is fine', made;

  -- Leave nothing behind.
  perform set_config('role', 'postgres', true);
  delete from public.conversations where id = made;

exception when others then
  raise notice 'INSERT FAILED: % / %', sqlstate, sqlerrm;
  perform set_config('role', 'postgres', true);
end $$;


-- 3. The exact policy expression now live on the insert.
select policyname, permissive, roles, with_check
from pg_policies
where schemaname = 'public' and tablename = 'conversations' and cmd = 'INSERT';
