// Translating the text that was written before the app spoke Portuguese.
//
// Task titles, descriptions and todos are things people typed, so they carry
// whatever language they were typed in. New work from the AI organiser comes
// out in Portuguese already; this is for everything that predates it.
//
// It runs as the owner and rewrites live content, so it is deliberately not
// wired to a button: it is called once, from the SQL editor or curl, and it
// reports what it changed.

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

const SYSTEM = `You translate short pieces of workplace text into European Portuguese (pt-PT, as spoken in Portugal — not Brazilian).

Rules:
- Return ONLY a JSON object of the form {"out": ["…", "…"]}, one entry per input, in the same order. No markdown, no explanation.
- Text already in Portuguese comes back unchanged.
- Never translate a person's name, a company name, a product name, a file name, a URL, or a technical term that is used in English in Portuguese offices (e.g. briefing, feedback, post, email, software names).
- Keep it the same length and register: these are task titles and short notes, not prose. A title stays a title.
- Preserve any punctuation or numbering the original carries.`

/** One batch through the model, returned in the same order it went in. */
async function translate(client: OpenAI, texts: string[]): Promise<string[]> {
  if (texts.length === 0) return []

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify({ in: texts }) },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? ''
  let parsed: { out?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('The model did not return usable JSON.')
  }

  const out = parsed.out
  if (!Array.isArray(out) || out.length !== texts.length) {
    // A mismatched batch cannot be lined up with its inputs, and writing it
    // back would put the wrong text on the wrong row.
    throw new Error(`Expected ${texts.length} translations, got ${Array.isArray(out) ? out.length : 'none'}.`)
  }
  return out.map((v, i) => (typeof v === 'string' && v.trim() ? v : texts[i]))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return json({ error: 'OPENAI_API_KEY is not set on this project.' }, 503)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  // The caller's own session decides whether this may run at all; the writing
  // is done with the service role because it spans everybody's rows.
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: userErr } = await asCaller.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, ''),
  )
  if (userErr || !user) return json({ error: 'Invalid session' }, 401)

  const { data: profile } = await asCaller.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return json({ error: 'Only a manager can run this.' }, 403)
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // dryRun reports what would change without writing anything.
  let dryRun = true
  try {
    const body = await req.json()
    dryRun = body?.dryRun !== false
  } catch {
    // No body: the safe reading.
  }

  const client = new OpenAI({ apiKey })
  const report: Record<string, unknown> = { dryRun }

  // Each table, the columns worth translating, in batches small enough that a
  // failure loses little and the model keeps the order straight.
  const jobs: { table: string; columns: string[] }[] = [
    { table: 'tasks', columns: ['title', 'description'] },
    { table: 'project_todos', columns: ['title', 'notes'] },
    { table: 'categories', columns: ['name'] },
  ]

  try {
    for (const job of jobs) {
      const { data: rows, error } = await db
        .from(job.table)
        .select(['id', ...job.columns].join(','))
        .limit(1000)

      if (error) {
        report[job.table] = { error: error.message }
        continue
      }

      const changes: { id: string; before: string; after: string; column: string }[] = []

      for (const column of job.columns) {
        const pending = (rows ?? []).filter(
          (r: any) => typeof r[column] === 'string' && r[column].trim().length > 1,
        )

        for (let i = 0; i < pending.length; i += 25) {
          const batch = pending.slice(i, i + 25)
          const out = await translate(client, batch.map((r: any) => r[column]))

          for (let j = 0; j < batch.length; j++) {
            const before = (batch[j] as any)[column] as string
            const after = out[j]
            if (after === before) continue
            changes.push({ id: (batch[j] as any).id, column, before, after })

            if (!dryRun) {
              await db.from(job.table).update({ [column]: after }).eq('id', (batch[j] as any).id)
            }
          }
        }
      }

      report[job.table] = { changed: changes.length, examples: changes.slice(0, 5) }
    }
  } catch (e) {
    console.error('[translate-content] failed:', e)
    return json({ error: (e as Error).message, partial: report }, 502)
  }

  return json(report)
})
