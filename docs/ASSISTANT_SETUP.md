# Setting up the FlowDesk assistant

Three steps: apply the database migration, add an Anthropic API key to
Supabase, and deploy the two Edge Functions. Nothing here touches the desktop
app — it loads the website, so it picks all this up automatically.

## 1. Apply the migration

Supabase dashboard → **SQL Editor** → paste the contents of
`supabase/migrations/20260824000003_do_dates_and_calendar.sql` → **Run**.

This adds do dates to todos, the `calendar_entries` table, and the sharing and
visibility rules. It is written to be safe to run once; if you ever re-run it
and Postgres complains that a policy already exists, that means it is already
applied and there is nothing to do.

## 2. Get an Anthropic API key

The assistant calls the Claude API, which is **billed separately from a
Claude.ai subscription** — a Pro or Max plan does not cover it and cannot be
used here. For two or three managers using the assistant through the day,
expect a few dollars a month.

1. Go to <https://console.anthropic.com>, sign in, and open **API keys**.
2. Create a key and copy it (it starts `sk-ant-`). You only see it once.
3. Add a small amount of credit under **Billing** — start with $5.

## 3. Give the key to Supabase (never to the app)

The key must stay server-side. Do **not** put it in `.env`, in
`VITE_ANTHROPIC_API_KEY`, or anywhere in `src/` — anything the front end can
read is readable by anyone who opens the deployed site.

Supabase dashboard → **Edge Functions** → **Secrets** → add:

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | the `sk-ant-…` key |

Or from a terminal, if you have the Supabase CLI logged in:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Until this exists, the assistant answers with a clear "not configured yet"
message rather than failing strangely.

## 4. Deploy the functions

```bash
supabase login          # one-off, opens a browser
supabase link --project-ref bccqkppxfpncdpalhkws
supabase functions deploy assistant
supabase functions deploy generate-tasks
```

`assistant` powers the chat panel. `generate-tasks` replaces the old AI
Organiser code that ran in the browser with the key exposed — deploy it too, or
that page stops working.

## What the assistant can do

It sees the project's description, todo lists, open todos, people, calendar and
recent documents, and it can:

- add and edit todos (including do dates, deadlines, assignee, priority)
- block time on the calendar (busy, working, meeting, time off)
- rewrite the project description when you tell it something that makes it stale
- ask you a multiple-choice question when it needs a decision — which list,
  which person, which day — and act on your answer

Everything it does runs **as you**: it uses your session, so it can only read
and change what you could yourself. It cannot see another person's private
calendar entries, and an employee using it cannot reach manager-only data.

## Do dates vs due dates

- **Due date** — the hard deadline. Shown in red on the calendar if nothing is
  planned for it.
- **Do date** — the day you actually intend to do the work. This is what fills
  the calendar, and what the assistant picks when you ask "when should I do
  this?".

A todo with a deadline and no do date shows up under **Not scheduled yet** at
the bottom of the calendar, which is the list to work through when planning
your week.

## Calendar visibility

Each entry can override the role default:

| Setting | Who sees it |
| --- | --- |
| *(default)* | Managers see everything; each person sees their own |
| Private | Only the owner — managers included |
| Team | Everyone on that project |
| Everyone | Everyone in the company |

Individual sharing (`calendar_entry_shares`, `project_todo_shares`) exists in
the database for naming specific people; the UI for it is not built yet.
