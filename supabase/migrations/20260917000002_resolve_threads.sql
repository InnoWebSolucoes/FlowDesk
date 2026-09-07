-- A task discussion can be finished with.
--
-- A task room stayed in the list for ever, so the chat filled with
-- conversations about work that was done weeks ago and the ones that still
-- mattered were buried among them.
--
-- Resolving a room archives it: it leaves the list, the record survives, and a
-- manager can still go back to it. Anyone in the room may resolve it, since the
-- person who did the work usually knows first that the discussion is over.
--
-- Names are left unqualified deliberately. Writing public.conversations was
-- reported as a missing relation against a table that answers queries
-- perfectly well, so the schema is left to the session that runs this.

alter table conversations
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references users(id) on delete set null;

create index if not exists conversations_resolved_idx
  on conversations(resolved_at);

-- conversations_update already allows anyone who can see the room to write to
-- it, which is how last_message_at and the room's folder are set, so resolving
-- needs no new policy.
