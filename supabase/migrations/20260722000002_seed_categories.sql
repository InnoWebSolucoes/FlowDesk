-- Seed categories (no auth dependency, safe to run immediately).
-- Websites/guidelines/tasks are NOT seeded here because they reference employee ids,
-- which don't exist until real Supabase Auth accounts are created. Recreate those
-- through the live app (Task Manager / Toolbox / Guidelines pages) after cutover.

insert into public.categories (id, name, color) values
  (gen_random_uuid(), 'Social Media', '#1A5C3A'),
  (gen_random_uuid(), 'Engagement', '#1B4F8A'),
  (gen_random_uuid(), 'Content', '#7A4A0A'),
  (gen_random_uuid(), 'Ads', '#7A2020'),
  (gen_random_uuid(), 'Reports', '#3A2A7A'),
  (gen_random_uuid(), 'Admin', '#6B6960'),
  (gen_random_uuid(), 'Google Business', '#2A5C1E'),
  (gen_random_uuid(), 'TripAdvisor', '#7A4010');
