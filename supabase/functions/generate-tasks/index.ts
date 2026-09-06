// Task generation for the AI Organiser.
//
// This used to run in the browser with the API key bundled into the front
// end, where anyone could read it out of the JavaScript. It runs here instead
// so the key stays server-side.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'npm:openai@4.77.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// JSON mode requires the response to be an object, not a bare array, so the
// tasks come back wrapped and get unwrapped below. The front end still
// receives a plain array and needs no changes.
const SYSTEM = `You are a workforce management assistant. The user will describe what they need an employee to do. Return ONLY a valid JSON object of the form {"tasks": [...]} — no markdown, no explanation, no code blocks. Each task object in the array must have these exact fields: title (string), description (string), frequency (object with type being one of 'daily', 'weekly', 'monthly', or 'one-off'; for weekly include days as an array of numbers 0-6 where 1=Mon…5=Fri; for monthly include weekOfMonth 1-4 and dayOfWeek 1-5; for one-off include date as an ISO string), categoryName (string), priority (one of 'low', 'medium', 'high'), estimatedMinutes (number), suggestedAssignees (array of strings — the names of the people this task should go to, chosen from the team list given below; use an empty array if the brief gives no basis to choose), deadline (the hard due date as YYYY-MM-DD, or null when the brief gives none), doDate (the day the work should actually be done as YYYY-MM-DD, or null; never later than deadline). Be thorough — extract every distinct task. When the brief names people or describes roles, route each task to whoever it belongs to rather than assigning everything to everyone. The roster marks who is a manager: work the brief says the writer will do themselves, or that plainly belongs to whoever is running things rather than to staff, goes to the manager by name like any other assignment. When it gives a date, a deadline or a day, fill deadline and doDate rather than leaving them null. Today's date appears in the user message; resolve anything relative against it. The brief may be written in English or Portuguese; understand either. Whatever language it arrives in, write every title and description in European Portuguese (pt-PT, as spoken in Portugal — not Brazilian), because the people who will read these tasks work in Portuguese. categoryName is Portuguese too. Do not translate people's names.`

// Refinement keeps the batch the manager is already looking at and applies
// their comments to it, so small corrections (a typo, a stray task, a date
// that shifted) don't mean describing all the work again from scratch.
const REFINE_SYSTEM = `You are a workforce management assistant revising a batch of tasks you previously generated. You will be given the current tasks as JSON and the manager's requested changes. Apply ONLY the requested changes and return the COMPLETE revised batch — every task that should still exist, not just the ones you changed. Keep untouched tasks byte-identical. Remove tasks the manager says to remove, add ones they ask for, and edit the rest as instructed. Return ONLY a valid JSON object of the form {"tasks": [...]} — no markdown, no explanation, no code blocks. Each task object must have these exact fields: title (string), description (string), frequency (object with type being one of 'daily', 'weekly', 'monthly', or 'one-off'; for weekly include days as an array of numbers 0-6 where 1=Mon…5=Fri; for monthly include weekOfMonth 1-4 and dayOfWeek 1-5; for one-off include date as an ISO string), categoryName (string), priority (one of 'low', 'medium', 'high'), estimatedMinutes (number), suggestedAssignees (array of strings — the names of the people this task should go to, chosen from the team list given below; use an empty array if the brief gives no basis to choose), deadline (the hard due date as YYYY-MM-DD, or null when the brief gives none), doDate (the day the work should actually be done as YYYY-MM-DD, or null; never later than deadline). The brief may be written in English or Portuguese; understand either. Whatever language it arrives in, write every title and description in European Portuguese (pt-PT, as spoken in Portugal — not Brazilian), because the people who will read these tasks work in Portuguese. categoryName is Portuguese too. Do not translate people's names.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return json(
      { error: 'Task generation is not configured yet: OPENAI_API_KEY is not set on this project.' },
      503,
    )
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  // Validate the bearer token explicitly — see the note in assistant/index.ts.
  const { data: { user }, error: userErr } = await db.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, ''),
  )
  if (userErr || !user) {
    return json({ error: `Invalid session: ${userErr?.message ?? 'no user for this token'}` }, 401)
  }

  // Managers are in the roster too: work from one brief often splits between
  // the team and the person writing it, and the model cannot route to anybody
  // it has not been told about.
  const { data: team } = await db
    .from('users')
    .select('name, role, job_title, department')
  const roster = (team ?? [])
    .map((p: any) => {
      const role = p.job_title
        ? ` (${p.job_title}${p.department ? `, ${p.department}` : ''})`
        : ''
      // Marked, so the model can tell whose work is whose when the brief
      // says "I will do this myself".
      return `- ${p.name}${role}${p.role === 'admin' ? ' — manager' : ''}`
    })
    .join('\n')

  // Without today's date the model cannot turn "next Friday" or "end of
  // the month" into the real dates the brief is asking for.
  const todayLine = `Today is ${new Date().toISOString().slice(0, 10)}.`

  let description = ''
  let currentTasks: unknown = null
  try {
    ({ description, tasks: currentTasks = null } = await req.json())
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  if (!description?.trim()) return json({ error: 'description is required' }, 400)

  // When the caller sends the batch it already has, `description` is a set of
  // corrections to apply to it rather than a fresh brief.
  const isRefinement = Array.isArray(currentTasks) && currentTasks.length > 0

  try {
    const client = new OpenAI({ apiKey })
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 8192,
      response_format: { type: 'json_object' },
      messages: isRefinement
        ? [
            { role: 'system', content: REFINE_SYSTEM },
            {
              role: 'user',
              content: `${todayLine}

Current tasks:
${JSON.stringify(currentTasks, null, 2)}

Requested changes:
${description}`,
            },
          ]
        : [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: roster
                ? `${todayLine}

Team available:\n${roster}\n\nBrief:\n${description}`
                : `${todayLine}

Brief:
${description}`,
            },
          ],
    })

    const choice = completion.choices[0]
    if (choice?.finish_reason === 'length') {
      return json({ error: 'That produced too many tasks to return at once. Try narrowing the request.' }, 502)
    }

    const text = choice?.message?.content ?? ''

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return json({ error: 'The model did not return usable JSON. Try rephrasing.' }, 502)
    }

    // JSON mode guarantees an object; the tasks live under a key inside it.
    // Accept a bare array too, in case the model ignores the wrapper.
    const tasks = Array.isArray(parsed)
      ? parsed
      : (parsed as { tasks?: unknown })?.tasks
    if (!Array.isArray(tasks)) return json({ error: 'Expected a list of tasks.' }, 502)

    return json({ tasks })
  } catch (e) {
    console.error('[generate-tasks] failed:', e)
    return json({ error: `Could not generate tasks: ${(e as Error).message}` }, 502)
  }
})
