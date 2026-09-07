-- ============================================================================
-- Remove every task, so they can be added back in Portuguese.
--
-- Run this in the FlowDesk project — check the ref in the URL is
-- bccqkppxfpncdpalhkws before you do. It cannot be undone.
--
-- Todos are NOT touched: the boards, including whatever the organiser put on
-- the manager's own board, stay exactly as they are. This is assigned tasks
-- only.
-- ============================================================================

-- ─── 1. What is about to go ─────────────────────────────────────────────────
-- Run this on its own first. Everything below follows the tasks out by
-- cascade, so this is the whole of it.

select
  (select count(*) from tasks)                                   as tasks,
  (select count(*) from task_assignments)                        as assignments,
  (select count(*) from completion_logs)                         as completions,
  (select count(*) from task_statuses)                           as in_progress_marks,
  (select count(*) from task_comments)                           as comments,
  (select count(*) from task_files)                              as attached_files,
  (select count(*) from conversations where task_id is not null) as task_threads,
  (select count(*) from notifications where task_id is not null) as task_notifications;

-- And the tasks themselves, so the list is a list and not a number.
select t.title, t.created_at::date as created, count(ta.employee_id) as assigned_to
from tasks t
left join task_assignments ta on ta.task_id = t.id
group by t.id, t.title, t.created_at
order by t.created_at;


-- ─── 2. Remove them ─────────────────────────────────────────────────────────
-- One statement. Everything above follows by cascade: assignments, completion
-- history, in-progress marks, comments, attached files, the task's chat thread
-- and the notifications raised about it.
--
-- Files uploaded against a task leave their rows here but their bytes stay in
-- storage. They are orphaned rather than lost, and can be cleared from the
-- Storage browser afterwards if the space matters.

delete from tasks;


-- ─── 3. Confirm ─────────────────────────────────────────────────────────────
-- Every count zero, and the todo boards untouched.

select
  (select count(*) from tasks)                          as tasks_left,
  (select count(*) from task_assignments)               as assignments_left,
  (select count(*) from completion_logs)                as completions_left,
  (select count(*) from project_todos)                  as todos_untouched,
  (select count(*) from project_todo_lists)             as todo_lists_untouched;
