// Task generation for the AI Organiser.
//
// This used to run in the browser with the Anthropic key bundled into the
// front end, where anyone could read it out of the JavaScript. It runs here
// instead so the key stays server-side.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.79.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const SYSTEM = `You are a workforce management assistant. The user will describe what they need an employee to do. Return ONLY a valid JSON array of task objects — no markdown, no explanation, no code blocks. Each task object must have these exact fields: title (string), description (string), frequency (object with type being one of 'daily', 'weekly', 'monthly', or 'one-off'; for weekly include days as an array of numbers 0-6 where 1=Mon…5=Fri; for monthly include weekOfMonth 1-4 and dayOfWeek 1-5; for one-off include date as an ISO string), categoryName (string), priority (one of 'low', 'medium', 'high'), estimatedMinutes (number). Be thorough — extract every distinct task. Return raw JSON only.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json(
      { error: 'Task generation is not configured yet: ANTHROPIC_API_KEY is not set on this project.' },
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

  const { data: { user }, error: userErr } = await db.auth.getUser()
  if (userErr || !user) return json({ error: 'Invalid session' }, 401)

  // Generating tasks is a manager action, and it spends API credit.
  const { data: profile } = await db.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return json({ error: 'Only managers can generate tasks.' }, 403)

  let description = ''
  try {
    ({ description } = await req.json())
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  if (!description?.trim()) return json({ error: 'description is required' }, 400)

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{ role: 'user', content: description }],
    })

    if (message.stop_reason === 'refusal') {
      return json({ error: 'That request could not be processed.' }, 422)
    }

    const text = message.content.find((b) => b.type === 'text')?.text ?? ''
    const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()

    let tasks: unknown
    try {
      tasks = JSON.parse(cleaned)
    } catch {
      return json({ error: 'The model did not return usable JSON. Try rephrasing.' }, 502)
    }
    if (!Array.isArray(tasks)) return json({ error: 'Expected a list of tasks.' }, 502)

    return json({ tasks })
  } catch (e) {
    console.error('[generate-tasks] failed:', e)
    return json({ error: `Could not generate tasks: ${(e as Error).message}` }, 502)
  }
})
