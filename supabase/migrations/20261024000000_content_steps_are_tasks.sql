-- ============================================================================
-- Work on the content calendar is somebody's task.
--
-- A content plan, a shoot, an edit, a delivery for approval, a day loading
-- the scheduler, a one-off: each has a day and somebody who does it, and each
-- was visible only on the content calendar. The person it was given to never
-- saw it in their own tasks, so it was work they had to go looking for.
--
-- Now every step that has a day and somebody to do it is also a one-off task
-- for that person, and the two are kept as one thing:
--
--   · Created, re-dated, re-assigned or deleted on the content calendar — the
--     task follows.
--   · Ticked or unticked on either side — the other side follows.
--   · Moved to another day or handed to someone else from the task side — the
--     content calendar follows.
--   · Deleted from the task side — the step stays on the content calendar,
--     with nobody on it, because nobody has it in their tasks any more.
--
-- The syncing is done here, in triggers, rather than in the app: an employee
-- adding a one-off on the content calendar may not create tasks themselves
-- (tasks are the owner's to write), and a tick has to carry across however
-- it was made. The functions run as their owner for that reason.
--
-- Posting days are not included. They come from repeating rules — every third
-- or fourth week, ending on a date — which a task's schedule cannot express.
--
-- ─── What this file does to existing data: nothing ──────────────────────────
--
-- It adds four nullable columns to public.tasks and one nullable column to
-- each of content_recordings, content_edits and content_one_off_tasks, plus
-- an index, a check constraint (added `not valid`) and the triggers.
--
-- Nothing already on the content calendar gets a task. The new column on the
-- content tables, makes_tasks, is null on every row that exists when this
-- runs and defaults to true for every row added afterwards; the triggers act
-- only where it is true. Existing tasks are untouched: their new columns are
-- null, which is what "not from the content calendar" means.
--
-- No delete, update, truncate or drop of any table, column, policy or row.
-- Running it twice is the same as running it once.
-- ============================================================================


-- ─── The link from a task to the step it is ─────────────────────────────────

alter table public.tasks
  add column if not exists content_kind text,
  add column if not exists content_id uuid,
  add column if not exists content_client_id uuid
    references public.content_clients(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_content_kind_known'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_content_kind_known
      check (content_kind is null
             or content_kind in ('plan', 'record', 'edit', 'deliver', 'schedule', 'oneoff'))
      not valid;
  end if;
end $$;

-- One task per step.
create unique index if not exists tasks_content_step_idx
  on public.tasks(content_kind, content_id)
  where content_kind is not null;


-- ─── From now on ────────────────────────────────────────────────────────────
-- Added without a default, so every existing row reads null; the default is
-- set afterwards and applies only to rows inserted from here on.

alter table public.content_recordings add column if not exists makes_tasks boolean;
alter table public.content_recordings alter column makes_tasks set default true;

alter table public.content_edits add column if not exists makes_tasks boolean;
alter table public.content_edits alter column makes_tasks set default true;

alter table public.content_one_off_tasks add column if not exists makes_tasks boolean;
alter table public.content_one_off_tasks alter column makes_tasks set default true;


-- ─── Where each step keeps its day, its person and its tick ─────────────────

create or replace function public.content_step_columns(
  p_kind text,
  out tbl text, out day_col text, out who_col text, out done_col text
)
language sql immutable as $$
  select m.tbl, m.day_col, m.who_col, m.done_col from (values
    ('record',   'content_recordings',    'recorded_on', 'assignee_id',          'done_at'),
    ('plan',     'content_recordings',    'plan_on',     'plan_assignee_id',     'plan_done_at'),
    ('edit',     'content_edits',         'edited_on',   'assignee_id',          'done_at'),
    ('deliver',  'content_edits',         'deliver_on',  'deliver_assignee_id',  'deliver_done_at'),
    ('schedule', 'content_edits',         'schedule_on', 'schedule_assignee_id', 'schedule_done_at'),
    ('oneoff',   'content_one_off_tasks', 'day',         'assignee_id',          'done_at')
  ) as m(kind, tbl, day_col, who_col, done_col)
  where m.kind = p_kind
$$;


-- ─── A step becomes, stays, or stops being a task ───────────────────────────

create or replace function public.content_step_task(
  p_kind        text,
  p_id          uuid,
  p_project     uuid,
  p_client      uuid,
  p_title       text,
  p_description text,
  p_day         date,
  p_assignee    uuid,
  p_done_at     timestamptz,
  p_created_by  uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_task uuid;
  v_freq jsonb;
  v_hour int;
begin
  select id into v_task from tasks where content_kind = p_kind and content_id = p_id;

  -- No day, or nobody to do it: it is not anybody's task.
  if p_day is null or p_assignee is null then
    if v_task is not null then
      delete from tasks where id = v_task;
    end if;
    return;
  end if;

  v_freq := jsonb_build_object('type', 'one-off', 'date', to_char(p_day, 'YYYY-MM-DD'));

  if v_task is null then
    insert into tasks (project_id, title, description, frequency, created_by,
                       content_kind, content_id, content_client_id)
    values (p_project, p_title, p_description, v_freq, coalesce(p_created_by, auth.uid()),
            p_kind, p_id, p_client)
    returning id into v_task;
  else
    update tasks
    set project_id = p_project,
        title = p_title,
        description = p_description,
        frequency = v_freq,
        content_client_id = p_client
    where id = v_task
      and (project_id, title, description, frequency::jsonb, content_client_id)
          is distinct from (p_project, p_title, p_description, v_freq, p_client);
  end if;

  -- One person: whoever the content calendar says.
  delete from task_assignments where task_id = v_task and employee_id <> p_assignee;
  insert into task_assignments (task_id, employee_id)
  values (v_task, p_assignee)
  on conflict do nothing;

  -- The tick. Recorded against the person it is assigned to, on its own day;
  -- whether it was late is decided by completion_logs' own trigger.
  if p_done_at is not null then
    if not exists (
      select 1 from completion_logs where task_id = v_task and employee_id = p_assignee
    ) then
      v_hour := extract(hour from p_done_at at time zone 'Europe/Lisbon');
      insert into completion_logs (task_id, employee_id, completed_at, due_date, was_late, time_of_day)
      values (
        v_task, p_assignee, p_done_at, p_day, false,
        case when v_hour < 11 then 'early'
             when v_hour < 13 then 'mid-morning'
             when v_hour < 16 then 'afternoon'
             else 'end-of-day' end
      )
      on conflict do nothing;
    end if;
  else
    delete from completion_logs where task_id = v_task;
  end if;
end;
$$;

-- Called by the triggers below and never by the app. It writes tasks as the
-- table's owner, so anyone able to call it directly could hand anybody work;
-- Supabase grants every new function to anon and authenticated by default,
-- so both are named here.
revoke all on function public.content_step_task(text, uuid, uuid, uuid, text, text, date, uuid, timestamptz, uuid)
  from public, anon, authenticated;


-- ─── From the content calendar to the task ──────────────────────────────────
-- pg_trigger_depth() > 1 means this change was itself made by one of these
-- triggers — a tick carried over from the task side, say — and has nothing to
-- carry back. Without it the two sides would hand the same change to each
-- other indefinitely.

create or replace function public.content_recording_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_client  text;
  v_videos  text;
begin
  if pg_trigger_depth() > 1 or new.makes_tasks is not true then
    return null;
  end if;
  select project_id, name into v_project, v_client from content_clients where id = new.client_id;
  v_videos := new.pieces || case when new.pieces = 1 then ' vídeo' else ' vídeos' end;

  perform content_step_task(
    'record', new.id, v_project, new.client_id,
    'Gravação · ' || v_client,
    'Gravar ' || v_videos || ' para ' || v_client || '.'
      || case when btrim(new.notes) <> '' then E'\n\n' || new.notes else '' end,
    new.recorded_on, new.assignee_id, new.done_at, new.created_by
  );

  perform content_step_task(
    'plan', new.id, v_project, new.client_id,
    'Plano de conteúdo · ' || v_client,
    'Fazer o plano de conteúdo da gravação de ' || to_char(new.recorded_on, 'DD/MM')
      || ' (' || v_videos || ') e carregá-lo na página de ' || v_client
      || ' no calendário de conteúdo.'
      || case when btrim(new.plan_notes) <> '' then E'\n\n' || new.plan_notes else '' end,
    new.plan_on, new.plan_assignee_id, new.plan_done_at, new.created_by
  );
  return null;
end;
$$;

drop trigger if exists content_recording_tasks on public.content_recordings;
create trigger content_recording_tasks
  after insert or update on public.content_recordings
  for each row execute function public.content_recording_tasks();


create or replace function public.content_edit_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_client  text;
  v_videos  text;
begin
  if pg_trigger_depth() > 1 or new.makes_tasks is not true then
    return null;
  end if;
  select project_id, name into v_project, v_client from content_clients where id = new.client_id;
  v_videos := new.pieces || case when new.pieces = 1 then ' vídeo' else ' vídeos' end;

  perform content_step_task(
    'edit', new.id, v_project, new.client_id,
    'Edição · ' || v_client,
    'Editar ' || v_videos || ' de ' || v_client || '.'
      || case when btrim(new.notes) <> '' then E'\n\n' || new.notes else '' end,
    new.edited_on, new.assignee_id, new.done_at, new.created_by
  );

  perform content_step_task(
    'deliver', new.id, v_project, new.client_id,
    'Entrega · ' || v_client,
    'Enviar a ' || v_client || ' para aprovação os ' || v_videos
      || ' editados a ' || to_char(new.edited_on, 'DD/MM') || '.',
    new.deliver_on, new.deliver_assignee_id, new.deliver_done_at, new.created_by
  );

  perform content_step_task(
    'schedule', new.id, v_project, new.client_id,
    'Agendamento · ' || v_client,
    'Carregar no agendador os ' || v_videos || ' aprovados de ' || v_client
      || ' (editados a ' || to_char(new.edited_on, 'DD/MM') || ').',
    new.schedule_on, new.schedule_assignee_id, new.schedule_done_at, new.created_by
  );
  return null;
end;
$$;

drop trigger if exists content_edit_tasks on public.content_edits;
create trigger content_edit_tasks
  after insert or update on public.content_edits
  for each row execute function public.content_edit_tasks();


create or replace function public.content_one_off_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_client text;
begin
  if pg_trigger_depth() > 1 or new.makes_tasks is not true then
    return null;
  end if;
  select name into v_client from content_clients where id = new.client_id;

  perform content_step_task(
    'oneoff', new.id, new.project_id, new.client_id,
    new.title || coalesce(' · ' || v_client, ''),
    new.detail,
    new.day, new.assignee_id, new.done_at, new.created_by
  );
  return null;
end;
$$;

drop trigger if exists content_one_off_task on public.content_one_off_tasks;
create trigger content_one_off_task
  after insert or update on public.content_one_off_tasks
  for each row execute function public.content_one_off_task();


-- A step deleted takes its task with it. No depth check: deleting a client
-- deletes its recordings and edits by cascade, which arrives here from inside
-- another trigger, and their tasks must go all the same.
create or replace function public.content_row_drop_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from tasks where content_id = old.id and content_kind is not null;
  return null;
end;
$$;

drop trigger if exists content_recording_drop_tasks on public.content_recordings;
create trigger content_recording_drop_tasks
  after delete on public.content_recordings
  for each row execute function public.content_row_drop_tasks();

drop trigger if exists content_edit_drop_tasks on public.content_edits;
create trigger content_edit_drop_tasks
  after delete on public.content_edits
  for each row execute function public.content_row_drop_tasks();

drop trigger if exists content_one_off_drop_task on public.content_one_off_tasks;
create trigger content_one_off_drop_task
  after delete on public.content_one_off_tasks
  for each row execute function public.content_row_drop_tasks();


-- ─── From the task to the content calendar ──────────────────────────────────

-- Ticked or unticked in somebody's tasks.
create or replace function public.content_done_from_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_id   uuid;
  c      record;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  select content_kind, content_id into v_kind, v_id
  from tasks where id = coalesce(new.task_id, old.task_id);
  if v_kind is null then
    return null;
  end if;
  c := content_step_columns(v_kind);

  if tg_op = 'INSERT' then
    execute format('update public.%I set %I = $1 where id = $2 and %I is null',
                   c.tbl, c.done_col, c.done_col)
      using new.completed_at, v_id;
    if v_kind = 'oneoff' then
      update content_one_off_tasks set done_by = new.employee_id where id = v_id;
    end if;
  else
    -- Undone only once no tick is left on it: two people can share a task.
    if exists (select 1 from completion_logs where task_id = old.task_id) then
      return null;
    end if;
    execute format('update public.%I set %I = null where id = $1 and %I is not null',
                   c.tbl, c.done_col, c.done_col)
      using v_id;
    if v_kind = 'oneoff' then
      update content_one_off_tasks set done_by = null where id = v_id;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists completion_logs_content on public.completion_logs;
create trigger completion_logs_content
  after insert or delete on public.completion_logs
  for each row execute function public.content_done_from_task();


-- Moved to another day from the task calendar.
create or replace function public.content_day_from_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c     record;
  v_day date;
begin
  if pg_trigger_depth() > 1 or new.content_kind is null then
    return null;
  end if;
  if new.frequency::jsonb ->> 'type' <> 'one-off'
     or coalesce(new.frequency::jsonb ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  v_day := (new.frequency::jsonb ->> 'date')::date;
  c := content_step_columns(new.content_kind);
  execute format('update public.%I set %I = $1 where id = $2 and %I is distinct from $1',
                 c.tbl, c.day_col, c.day_col)
    using v_day, new.content_id;
  return null;
end;
$$;

drop trigger if exists tasks_content_day on public.tasks;
create trigger tasks_content_day
  after update of frequency on public.tasks
  for each row execute function public.content_day_from_task();


-- Handed to someone else, or to nobody, from the task side.
create or replace function public.content_person_from_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_id   uuid;
  v_who  uuid;
  c      record;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  select content_kind, content_id into v_kind, v_id
  from tasks where id = coalesce(new.task_id, old.task_id);
  if v_kind is null then
    return null;
  end if;
  c := content_step_columns(v_kind);

  if tg_op = 'INSERT' then
    v_who := new.employee_id;
  else
    -- Somebody else still has it: the step keeps whoever was added last.
    if exists (select 1 from task_assignments where task_id = old.task_id) then
      return null;
    end if;
    v_who := null;
  end if;

  execute format('update public.%I set %I = $1 where id = $2 and %I is distinct from $1',
                 c.tbl, c.who_col, c.who_col)
    using v_who, v_id;
  return null;
end;
$$;

drop trigger if exists task_assignments_content on public.task_assignments;
create trigger task_assignments_content
  after insert or delete on public.task_assignments
  for each row execute function public.content_person_from_task();


-- Deleted from the task side. The step stays on the content calendar — it is
-- still work to be done — but with nobody on it, since nobody has it in their
-- tasks any more. (task_assignments goes by cascade first, and that path
-- arrives inside this delete's own trigger depth, so it is cleared here.)
create or replace function public.content_task_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  if pg_trigger_depth() > 1 or old.content_kind is null then
    return null;
  end if;
  c := content_step_columns(old.content_kind);
  execute format('update public.%I set %I = null where id = $1 and %I is not null',
                 c.tbl, c.who_col, c.who_col)
    using old.content_id;
  return null;
end;
$$;

drop trigger if exists tasks_content_deleted on public.tasks;
create trigger tasks_content_deleted
  after delete on public.tasks
  for each row execute function public.content_task_deleted();


-- So the app picks up the new columns without waiting for a schema reload.
notify pgrst, 'reload schema';
