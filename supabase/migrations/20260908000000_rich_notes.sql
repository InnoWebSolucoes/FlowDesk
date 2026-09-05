-- Notes become documents, not sticky labels.
--
-- The board was built as Google Keep: a title, a plain-text body, and an
-- optional flat checklist. That is too little to actually write in — no
-- formatting, no tables, no drawings, and a note you could not really come
-- back to and keep working on.
--
-- The body becomes rich content (HTML from the editor). The plain body is
-- kept and backfilled into it, so nothing written so far is lost, and it stays
-- as the search/preview text.

alter table public.project_notes
  -- Rich HTML from the editor. Empty until the note is edited, at which point
  -- the plain body below is migrated into it.
  add column if not exists content text not null default '',
  -- Reserved for storing drawings as re-editable strokes. Drawings currently
  -- embed into `content` as images, which cannot be reopened for editing;
  -- this is where the stroke data will live when that is addressed. Unused
  -- for now, and harmless to keep so the column need not be added later.
  add column if not exists drawings jsonb not null default '[]'::jsonb;

-- Carry every existing note's plain body into the rich field, as paragraphs.
-- Done once: after this the editor owns `content`, and `body` is the plain
-- text mirror kept for searching.
update public.project_notes
set content = '<p>' || replace(
    replace(replace(replace(body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
    E'\n', '</p><p>'
  ) || '</p>'
where content = '' and coalesce(body, '') <> '';

-- Existing checklists become task lists in the rich body, so the conversion
-- does not silently drop them. Items stay in their own table as well, which
-- keeps the old checklist rendering working for notes nobody has opened yet.
update public.project_notes n
set content = n.content || coalesce((
  select '<ul data-type="taskList">' || string_agg(
    '<li data-type="taskItem" data-checked="' || (case when i.is_checked then 'true' else 'false' end) || '"><p>'
      || replace(replace(replace(i.text, '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
      || '</p></li>',
    '' order by i.sort_order
  ) || '</ul>'
  from public.project_note_items i
  where i.note_id = n.id
), '')
where exists (select 1 from public.project_note_items i where i.note_id = n.id)
  -- Only once: re-running must not append the checklist a second time.
  and n.content not like '%data-type="taskList"%';
