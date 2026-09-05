// The FlowDesk assistant.
//
// Runs the tool-use loop server-side so the API key never reaches the
// browser. The caller's own Supabase session is forwarded to every database
// call, so the assistant can only ever read or write what that person could
// do by hand — RLS stays in force.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'npm:openai@4.77.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MODEL = 'gpt-4o'
const MAX_STEPS = 8

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_todo',
      description:
        'Add a todo to one of the project\'s lists. Use ask_user first if it is not obvious which list it belongs to, or who should do it.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short imperative title.' },
          notes: { type: 'string', description: 'Optional detail.' },
          list_id: { type: 'string', description: 'Which todo list. Omit for the first list.' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          due_date: { type: 'string', description: 'Hard deadline, YYYY-MM-DD.' },
          do_date: {
            type: 'string',
            description: 'The day the work will actually be done, YYYY-MM-DD. This is what appears on the calendar.',
          },
          assignee_id: { type: 'string', description: 'User id of the person who will do it.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_todo',
      description: 'Change an existing todo: reschedule it, reassign it, complete it, or edit its text.',
      parameters: {
        type: 'object',
        properties: {
          todo_id: { type: 'string' },
          title: { type: 'string' },
          notes: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          due_date: { type: 'string' },
          do_date: { type: 'string' },
          assignee_id: { type: 'string' },
          is_completed: { type: 'boolean' },
        },
        required: ['todo_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_calendar_entry',
      description:
        'Block out days on the calendar: busy, working, a meeting, or time off. The calendar is organised by day — there are no times.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          notes: { type: 'string' },
          kind: { type: 'string', enum: ['busy', 'working', 'meeting', 'timeoff'] },
          starts_on: { type: 'string', description: 'First day it covers, YYYY-MM-DD.' },
          ends_on: { type: 'string', description: 'Last day it covers, inclusive. Same as starts_on for one day.' },
          visibility: { type: 'string', enum: ['private', 'team', 'everyone'] },
        },
        required: ['starts_on', 'ends_on'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_project_description',
      description:
        'Rewrite the project description to reflect what is actually happening now. Use when the user reports news that makes the stored description stale.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'The complete new description, not a diff.' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Ask the user a question with a few concrete options, exactly when you genuinely need their decision (which list, which person, which day). Do not use it for things you can infer. Stop after calling this — the answer arrives as the next user message.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['label'],
            },
            minItems: 2,
            maxItems: 4,
          },
          allow_multiple: { type: 'boolean' },
        },
        required: ['question', 'options'],
      },
    },
  },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return json(
      { error: 'The assistant is not configured yet: OPENAI_API_KEY is not set on this project.' },
      503,
    )
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  // Every DB call below runs as the caller, so RLS applies unchanged.
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user }, error: userErr } = await db.auth.getUser()
  if (userErr || !user) return json({ error: 'Invalid session' }, 401)

  let body: {
    projectId?: string
    messages?: OpenAI.Chat.ChatCompletionMessageParam[]
    timezone?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const { projectId, messages = [], timezone = 'UTC' } = body
  if (!projectId) return json({ error: 'projectId is required' }, 400)
  if (messages.length === 0) return json({ error: 'messages must not be empty' }, 400)

  // ── Context: what the assistant knows before it answers ──────────────────
  const [
    projectRes, listsRes, todosRes, peopleRes, itemsRes, entriesRes,
    tasksRes, doneRes, progressRes, notesRes, categoriesRes,
  ] = await Promise.all([
    db.from('projects').select('id,name,company_name,description,industry').eq('id', projectId).single(),
    db.from('project_todo_lists').select('id,name').eq('project_id', projectId).order('sort_order'),
    db
      .from('project_todos')
      .select('id,title,list_id,priority,is_completed,due_date,do_date,assignee_id')
      .eq('project_id', projectId)
      .order('sort_order')
      .limit(150),
    db.from('users').select('id,name,email,role').eq('project_id', projectId),
    db
      .from('resource_items')
      .select('id,title,file_name,updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(25),
    db
      .from('calendar_entries')
      .select('id,title,kind,starts_on,ends_on,owner_id')
      .eq('project_id', projectId)
      .gte('ends_on', new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10))
      .order('starts_on')
      .limit(80),

    // The assigned work. This was missing entirely, which is why the assistant
    // insisted employees had no tasks: project_todos is the managers' own
    // board, not what anyone was actually given to do.
    db
      .from('tasks')
      .select('id,title,description,frequency,priority,deadline,is_active,created_at,task_assignments(employee_id,do_date)')
      .eq('project_id', projectId)
      .limit(200),
    db
      .from('completion_logs')
      .select('task_id,employee_id,due_date,completed_at,was_late')
      .gte('due_date', new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
      .limit(400),
    db.from('task_statuses').select('task_id,employee_id,due_date').limit(200),
    // The notes board. owner_id null is the shared manager board; a set
    // owner_id is that person's private board, which RLS already hides from
    // everyone else, so this returns only what the caller may read.
    db
      .from('project_notes')
      .select('id,title,body,is_pinned,owner_id,updated_at')
      .eq('project_id', projectId)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(40),
    // Categories name the kind of work a task is, which is how people
    // describe it out loud ("the social media stuff").
    db.from('categories').select('id,name').limit(60),
  ])

  if (projectRes.error || !projectRes.data) {
    return json({ error: 'Project not found, or you do not have access to it.' }, 404)
  }

  const project = projectRes.data
  const lists = listsRes.data ?? []
  const todos = todosRes.data ?? []
  const people = peopleRes.data ?? []
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  // ── Assigned work, per person ───────────────────────────────────────────
  const allTasks = (tasksRes.data ?? []) as any[]
  const doneLogs = (doneRes.data ?? []) as any[]
  const inProgress = (progressRes.data ?? []) as any[]

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'someone'

  const statusOf = (taskId: string, employeeId: string): string => {
    if (doneLogs.some((l) => l.task_id === taskId && l.employee_id === employeeId && l.due_date === today)) {
      return 'DONE today'
    }
    if (inProgress.some((s) => s.task_id === taskId && s.employee_id === employeeId && s.due_date === today)) {
      return 'IN PROGRESS'
    }
    return 'not started'
  }

  const freqText = (f: any): string => {
    if (!f || typeof f !== 'object') return 'once'
    if (f.type === 'daily') return 'every weekday'
    if (f.type === 'weekly') return `weekly (days ${(f.days ?? []).join(',')})`
    if (f.type === 'monthly') return `monthly (week ${f.weekOfMonth}, day ${f.dayOfWeek})`
    if (f.type === 'one-off') return `one-off${f.date ? ` on ${f.date}` : ''}`
    return String(f.type ?? 'once')
  }

  // Grouped by person, because that is how it is always asked about: "what
  // does X have on", "is X behind".
  const workByPerson = people
    .filter((p) => p.role !== 'admin')
    .map((p) => {
      const mine = allTasks.filter(
        (t) => t.is_active && (t.task_assignments ?? []).some((a: any) => a.employee_id === p.id),
      )
      if (mine.length === 0) return `${p.name} [${p.id}]: no tasks assigned`

      const lines = mine.map((t) => {
        const assignment = (t.task_assignments ?? []).find((a: any) => a.employee_id === p.id)
        const overdue = t.deadline && t.deadline < today
        return `  - ${t.title} [${t.id}] — ${freqText(t.frequency)}, ${t.priority} priority`
          + `${t.deadline ? `, deadline ${t.deadline}${overdue ? ' (OVERDUE)' : ''}` : ', no deadline'}`
          + `${assignment?.do_date ? `, planned for ${assignment.do_date}` : ''}`
          + ` — ${statusOf(t.id, p.id)}`
      })
      return `${p.name} [${p.id}]: ${mine.length} task(s)
${lines.join('\n')}`
    })

  const employeeCount = people.filter((p) => p.role !== 'admin').length
  const managerCount = people.filter((p) => p.role === 'admin').length

  const system = `You are the FlowDesk assistant for the project "${project.name}"${
    project.company_name ? ` (${project.company_name})` : ''
  }. You help the user manage their work inside the app.

Today is ${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-GB', { weekday: 'long' })}). The user's timezone is ${timezone}.

DO DATE vs DUE DATE — this distinction matters and users rely on it:
- due_date is the hard deadline, the last acceptable moment.
- do_date is the day the person actually plans to do the work. The calendar shows do dates. When someone asks when to fit something in, you are choosing a do_date, and it must land on or before the due_date. The calendar is organised by day only — there are no times on it.

Current project description:
${project.description || '(empty)'}

Todo lists: ${lists.length ? lists.map((l) => `${l.name} [${l.id}]`).join(', ') : '(none yet)'}

TEAM — ${employeeCount} employee(s) and ${managerCount} manager(s) on this project:
${people.length ? people.map((p) => `- ${p.name} [${p.id}]${p.role === 'admin' ? ' (manager)' : ' (employee)'}${p.email ? ` <${p.email}>` : ''}`).join('\n') : '(nobody yet)'}

ASSIGNED WORK — the tasks people were actually given, with live status.
"DONE today" means completed today, "IN PROGRESS" means they have started it
and not finished, "not started" means neither. This is the authoritative
answer to anything about what someone has to do or how they are getting on:
${workByPerson.length ? workByPerson.join('\n') : '(nobody has any tasks)'}

Open todos:
${
  todos.filter((t) => !t.is_completed).slice(0, 40).map((t) =>
    `- ${t.title} [${t.id}]${t.due_date ? ` due ${t.due_date}` : ''}${t.do_date ? ` doing ${t.do_date}` : ' — NOT SCHEDULED'}`
  ).join('\n') || '(none)'
}

Calendar around now:
${
  (entriesRes.data ?? []).map((e) =>
    `- ${e.title} (${e.kind}) ${e.starts_on}${e.ends_on !== e.starts_on ? ` → ${e.ends_on}` : ''}`
  ).join('\n') || '(nothing blocked)'
}

Recent documents:
${(itemsRes.data ?? []).slice(0, 12).map((i) => `- ${i.title}`).join('\n') || '(none)'}

Notes board:
${
  (notesRes.data ?? []).slice(0, 20).map((n) => {
    const who = n.owner_id ? `${nameOf(n.owner_id)}'s note` : 'shared'
    const preview = (n.body ?? '').replace(/\s+/g, ' ').slice(0, 120)
    return `- ${n.title || '(untitled)'} [${n.id}] (${who})${n.is_pinned ? ' PINNED' : ''}${preview ? `: ${preview}` : ''}`
  }).join('\n') || '(none)'
}

Task categories: ${(categoriesRes.data ?? []).map((c) => c.name).join(', ') || '(none)'}

Linking. When you name something the user can open, make it a markdown link
so they can click straight to it. The paths, for this project:
- A document or file: [its title](/p/resources)
- The todo board: [the board](/p/todos) — a single todo: [its title](/p/todos?todo=<todo id>)
- The calendar: [the calendar](/p/calendar)
- Notes: [notes](/p/notes)
- The team list: [the team](/p/team) — one person: [their name](/p/team/<user id>)
- Assigned tasks: [tasks](/p/tasks)
Use the ids given in the context above. Link the thing's own name rather than
writing "click here", and do not invent a path that is not in this list. When
you list several things, link each one.

How to behave:
- Answer counts and status questions from the context above — it is complete
  and current. Never say you cannot see the data, and never claim someone has
  no tasks unless their line above actually says so.
- "Todos" and "tasks" are different things here. Todos are the manager's own
  lists; tasks are the work assigned to employees. Read which one is meant, and
  say which one you are answering about if it could be either.
- Act, don't just advise. If asked to add a todo, call create_todo.
- Use ask_user only for a decision genuinely yours to get wrong — which list, which person, which of two days. Never for something the context already answers.
- When suggesting when to do something, respect what is already on the calendar and say briefly why you picked that slot.
- If the user tells you something that makes the project description out of date (a new client, a change of scope, a finished phase), call update_project_description with a full rewritten description. Keep it factual and concise; never invent detail.
- Keep replies short and plain. No preamble, no restating the question.`

  const client = new OpenAI({ apiKey })
  // The system prompt is a message here rather than a separate field, and is
  // kept out of `convo` so it isn't echoed back to the client each turn.
  const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [...messages]
  const performed: { tool: string; summary: string }[] = []
  let pendingQuestion: unknown = null

  for (let step = 0; step < MAX_STEPS; step++) {
    let completion: OpenAI.Chat.ChatCompletion
    try {
      completion = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 4096,
        tools,
        messages: [{ role: 'system', content: system }, ...convo],
      })
    } catch (e) {
      console.error('[assistant] OpenAI call failed:', e)
      return json({ error: `The assistant could not be reached: ${(e as Error).message}` }, 502)
    }

    const message = completion.choices[0]?.message
    if (!message) {
      return json({ error: 'The assistant returned an empty response.' }, 502)
    }

    convo.push(message)

    const toolUses = message.tool_calls ?? []
    if (toolUses.length === 0) {
      return json({ reply: (message.content ?? '').trim(), actions: performed, messages: convo })
    }

    const results: OpenAI.Chat.ChatCompletionToolMessageParam[] = []

    for (const use of toolUses) {
      // Arguments arrive as a JSON string, and a malformed one must not take
      // down the turn — hand it back to the model as a tool failure instead.
      let args: Record<string, any> = {}
      let parseError: string | null = null
      try {
        args = JSON.parse(use.function.arguments || '{}')
      } catch {
        parseError = 'Arguments were not valid JSON. Call the tool again with valid JSON.'
      }
      let result: string

      try {
        if (parseError) throw new Error(parseError)
        switch (use.function.name) {
          case 'ask_user': {
            pendingQuestion = {
              question: args.question,
              options: args.options,
              allowMultiple: !!args.allow_multiple,
            }
            result = 'Question shown to the user; their answer will arrive as the next message.'
            break
          }

          case 'create_todo': {
            const listId = args.list_id ?? lists[0]?.id ?? null
            const { data, error } = await db
              .from('project_todos')
              .insert({
                project_id: projectId,
                list_id: listId,
                title: args.title,
                notes: args.notes ?? '',
                priority: args.priority ?? 'medium',
                due_date: args.due_date ?? null,
                do_date: args.do_date ?? null,
                assignee_id: args.assignee_id ?? null,
              })
              .select('id,title')
              .single()
            if (error) throw error
            performed.push({ tool: 'create_todo', summary: `Added "${data.title}"` })
            result = `Created todo ${data.id}.`
            break
          }

          case 'update_todo': {
            const patch: Record<string, unknown> = {}
            for (const [k, col] of [
              ['title', 'title'], ['notes', 'notes'], ['priority', 'priority'],
              ['due_date', 'due_date'], ['do_date', 'do_date'],
              ['assignee_id', 'assignee_id'],
            ] as const) {
              if (args[k] !== undefined) patch[col] = args[k]
            }
            if (args.is_completed !== undefined) {
              patch.is_completed = args.is_completed
              patch.completed_at = args.is_completed ? new Date().toISOString() : null
            }
            const { data, error } = await db
              .from('project_todos')
              .update(patch)
              .eq('id', args.todo_id)
              .select('id,title')
              .single()
            if (error) throw error
            performed.push({ tool: 'update_todo', summary: `Updated "${data.title}"` })
            result = `Updated todo ${data.id}.`
            break
          }

          case 'create_calendar_entry': {
            const { data, error } = await db
              .from('calendar_entries')
              .insert({
                project_id: projectId,
                owner_id: user.id,
                title: args.title ?? 'Busy',
                notes: args.notes ?? '',
                kind: args.kind ?? 'busy',
                starts_on: args.starts_on,
                ends_on: args.ends_on ?? args.starts_on,
                visibility: args.visibility ?? null,
              })
              .select('id,title')
              .single()
            if (error) throw error
            performed.push({ tool: 'create_calendar_entry', summary: `Blocked time: "${data.title}"` })
            result = `Created calendar entry ${data.id}.`
            break
          }

          case 'update_project_description': {
            const { error } = await db
              .from('projects')
              .update({ description: args.description })
              .eq('id', projectId)
            if (error) throw error
            performed.push({ tool: 'update_project_description', summary: 'Updated the project description' })
            result = 'Project description updated.'
            break
          }

          default:
            result = `Unknown tool ${use.function.name}.`
        }
      } catch (e) {
        // Hand the failure back to the model so it can explain or retry,
        // rather than collapsing the whole turn.
        result = `Failed: ${(e as Error).message ?? String(e)}`
      }

      results.push({ role: 'tool', tool_call_id: use.id, content: result })
    }

    // Each tool result is its own message, and every call in the batch must
    // get one back before the next request or the API rejects the thread.
    convo.push(...results)

    // A question needs a human answer; stop the loop and hand it to the UI.
    if (pendingQuestion) {
      return json({
        reply: (message.content ?? '').trim(),
        question: pendingQuestion,
        actions: performed,
        messages: convo,
      })
    }
  }

  return json({
    reply: 'That turned into more steps than I can take at once. Could you break it into smaller pieces?',
    actions: performed,
    messages: convo,
  })
})
