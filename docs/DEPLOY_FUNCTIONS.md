# Deploying the Edge Functions

FlowDesk has four server-side functions. They live in this repo under
`supabase/functions/`, but **living in the repo is not the same as being
deployed** — pushing to GitHub deploys the website to Vercel, and does nothing
for Supabase. Until a function is deployed, calling it fails with
"Failed to send a request to the Edge Function" (a 404 underneath).

| Function | What breaks without it |
| --- | --- |
| `create-employee` | Adding an employee |
| `delete-employee` | Removing an employee |
| `assistant` | The AI assistant panel |
| `generate-tasks` | The AI Organiser |

## One-time setup

```bash
supabase login                                  # opens a browser
supabase link --project-ref bccqkppxfpncdpalhkws
```

## Deploy

```bash
cd C:\Users\rafam\FlowDesk\FlowDesk
supabase functions deploy create-employee
supabase functions deploy delete-employee
supabase functions deploy assistant
supabase functions deploy generate-tasks
```

Or all at once:

```bash
supabase functions deploy
```

## Check what is actually deployed

```bash
supabase functions list
```

## Re-deploy after changing one

Editing a function's code and pushing to GitHub does **not** update it. Run its
`deploy` command again.

## The assistant needs a key as well

`assistant` and `generate-tasks` also need `ANTHROPIC_API_KEY` set under
**Edge Functions → Secrets** in the Supabase dashboard. Without it they deploy
fine but reply that they are not configured. See `ASSISTANT_SETUP.md`.
