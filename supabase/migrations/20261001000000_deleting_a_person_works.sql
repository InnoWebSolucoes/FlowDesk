-- ============================================================================
-- "Database error deleting user".
--
-- Deleting somebody failed because a dozen foreign keys point at
-- public.users(id) with no ON DELETE action at all — which in Postgres means
-- NO ACTION, i.e. refuse. So anyone who had ever created a task, written a
-- comment, uploaded a file or had a single line written to activity_logs
-- could not be removed, and the only thing said about it was GoTrue's
-- "Database error deleting user".
--
-- Every one of them gets a rule here, chosen per table rather than in bulk,
-- because the two answers mean different things:
--
--   SET NULL  — the row is the company's and outlives the person. A task,
--               a project, a document, a note: deleting whoever happened to
--               create it must not delete the thing itself. It forgets who,
--               and keeps what.
--
--   CASCADE   — the row *is* the person's own trace. Their comments, their
--               attachments, the activity log of what they did. The delete
--               dialog promises "their account and history", and this is the
--               history it means.
--
-- Several of these columns are NOT NULL, so the constraint cannot simply be
-- set to SET NULL — the column has to allow it first. That is the real change
-- here: a task remembers that somebody created it, and is now allowed to have
-- forgotten who.
-- ============================================================================


-- ─── The rewiring ───────────────────────────────────────────────────────────
-- Done by lookup rather than by constraint name: these were created inline
-- with the tables, so their names are whatever Postgres chose, and naming
-- them here would be guessing.

do $rewire$
declare
  target record;
  fk_name text;
begin
  for target in
    select * from (values
      -- table,                     column,          action,      allow null
      ('users',                'manager_id',    'set null', true),
      ('tasks',                'created_by',    'set null', true),
      ('documents',            'uploaded_by',   'set null', true),
      ('guidelines',           'updated_by',    'set null', true),
      ('projects',             'created_by',    'set null', true),
      ('resource_clusters',    'created_by',    'set null', true),
      ('resource_items',       'created_by',    'set null', true),
      ('resource_item_versions','created_by',   'set null', true),
      ('project_todos',        'created_by',    'set null', true),
      ('project_todos',        'completed_by',  'set null', true),
      ('project_todo_lists',   'created_by',    'set null', true),
      ('project_notes',        'created_by',    'set null', true),
      ('project_admins',       'granted_by',    'set null', true),
      -- Theirs, and going with them.
      ('task_comments',        'author_id',     'cascade',  false),
      ('task_attachments',     'uploaded_by',   'cascade',  false),
      ('activity_logs',        'actor_id',      'cascade',  false)
    ) as t(tbl, col, action, nullable)
  loop
    -- Skip anything this database does not have: the tables arrived across
    -- several migrations and not every install has every one.
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = target.tbl
        and column_name = target.col
    ) then
      continue;
    end if;

    -- The existing foreign key on this column, whatever it ended up called.
    select con.conname into fk_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = target.tbl
      and con.contype = 'f'
      and con.conkey = array[(
        select attnum from pg_attribute
        where attrelid = rel.oid and attname = target.col
      )]
    limit 1;

    if fk_name is not null then
      execute format('alter table public.%I drop constraint %I', target.tbl, fk_name);
    end if;

    if target.nullable then
      execute format('alter table public.%I alter column %I drop not null', target.tbl, target.col);
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.users(id) on delete %s',
      target.tbl,
      target.tbl || '_' || target.col || '_fkey',
      target.col,
      case when target.action = 'cascade' then 'cascade' else 'set null' end
    );
  end loop;
end
$rewire$;


-- ─── What is left pointing at a person with no rule ─────────────────────────
-- Anything listed here would still refuse a delete. Expect no rows.

select
  rel.relname as still_blocking_table,
  att.attname as column_name
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
join pg_class ref on ref.oid = con.confrelid
join pg_attribute att on att.attrelid = rel.oid and att.attnum = con.conkey[1]
where nsp.nspname = 'public'
  and con.contype = 'f'
  and ref.relname = 'users'
  and con.confdeltype = 'a'   -- 'a' = NO ACTION, the one that refuses
order by 1, 2;
