-- A notification about a person needs to say which person.
--
-- A workload alert names the employee in its message text — "Esmael: 9 tasks"
-- — and nowhere else. Clicking it therefore had nothing to navigate to and
-- fell back to the projects index, which is a page about nothing in
-- particular: the reader lands somewhere unrelated to what they clicked.
--
-- target_user_id could not carry it: that is who the notification is FOR, and
-- these are for the managers as a role. Who it is ABOUT is a separate fact.

alter table public.notifications
  add column if not exists subject_user_id uuid references public.users(id) on delete cascade;

create index if not exists notifications_subject_idx
  on public.notifications(subject_user_id);
