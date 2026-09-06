-- ============================================================================
-- FlowDesk — chat diagnosis.
--
-- Run this in the Supabase SQL editor and send back what the two queries
-- print. It changes nothing; it only reports what is actually in the database,
-- which is the part we have been guessing at.
-- ============================================================================

-- 1. Every policy currently live on the chat tables.
--
--    This is the important one. It shows what the database is really
--    enforcing, as opposed to what the migration files say — if the fix did
--    not apply, or an older policy is still present alongside the new one,
--    it shows up here.
--
--    A row with cmd = 'INSERT' and qual/with_check that is not simply
--    (created_by = auth.uid()) means CHAT_FIX.sql did not take effect.
select
  tablename,
  policyname,
  cmd,
  qual        as using_clause,
  with_check  as with_check_clause
from pg_policies
where schemaname = 'public'
  and tablename in (
    'conversations',
    'conversation_members',
    'chat_messages',
    'chat_message_items'
  )
order by tablename, cmd, policyname;


-- 2. Is there more than one INSERT policy on conversations?
--
--    Postgres ORs multiple permissive policies for the same command, so a
--    second one cannot cause a refusal on its own. But a RESTRICTIVE policy
--    is ANDed, and one of those left over from an earlier run would refuse
--    every insert no matter what the permissive policy says.
--
--    permissive = 'RESTRICTIVE' on any row here is the culprit.
select
  policyname,
  cmd,
  permissive,
  roles
from pg_policies
where schemaname = 'public'
  and tablename = 'conversations'
order by cmd, policyname;
