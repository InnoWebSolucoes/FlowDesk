import { supabase } from './supabaseClient'

/**
 * Task generation runs in the `generate-tasks` Edge Function, not here.
 *
 * The Anthropic key must never reach the browser: anything bundled into the
 * front end is readable by anyone who opens the deployed site, and the key
 * bills to our account. The function keeps it server-side and checks the
 * caller's session before spending anything.
 */
/**
 * The priorities the database accepts. `tasks.priority` and
 * `project_todos.priority` both carry a check constraint listing exactly
 * these, so anything else is refused on insert.
 */
type Priority = 'low' | 'medium' | 'high'

/**
 * What the model actually returns, mapped to what the column allows.
 *
 * The prompt asks for 'low' | 'medium' | 'high' and also asks for every title
 * and description in European Portuguese. The model generalises the second
 * instruction over the first and answers 'alta' or 'média', which the check
 * constraint rejects — an import failed with five tasks refused, every one of
 * them Portuguese. Translating here is more reliable than asking the prompt
 * again not to: the type says the field is one of three strings, but it
 * arrives from a language model and nothing has checked it until now.
 */
const PRIORITY_WORDS: Record<string, Priority> = {
  low: 'low', medium: 'medium', high: 'high',
  // Portuguese, with and without the accents the model may drop.
  baixa: 'low', baixo: 'low',
  media: 'medium', 'média': 'medium', medio: 'medium', 'médio': 'medium',
  alta: 'high', alto: 'high',
  // Occasionally seen in place of the middle value.
  normal: 'medium', urgente: 'high', urgent: 'high',
}

/** A priority the database will accept, whatever the model called it. */
function toPriority(value: unknown): Priority {
  if (typeof value !== 'string') return 'medium'
  return PRIORITY_WORDS[value.trim().toLowerCase()] ?? 'medium'
}

export async function generateTasks(
  description: string,
  /**
   * The batch already on screen. When present, `description` is read as
   * corrections to apply to these tasks rather than as a fresh brief, so a
   * manager can fix a typo or drop a task without re-describing the job.
   */
  currentTasks?: any[],
  /**
   * The titles of the manager's own boards. The function cannot work these
   * out — they belong to one person on one project — and without them the
   * model has nothing to match a task's kind against when it routes work to
   * the manager.
   */
  lists?: string[],
): Promise<any[]> {
  // Refresh an expired access token before calling, or a long editing session
  // fails with "Invalid session" rather than generating.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your session has expired. Please sign in again.')

  const { data, error } = await supabase.functions.invoke('generate-tasks', {
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: {
      description,
      ...(currentTasks?.length ? { tasks: currentTasks } : {}),
      ...(lists?.length ? { lists } : {}),
    },
  })

  // On a non-2xx, supabase-js throws away the body and hands back a
  // FunctionsHttpError whose message is always the same unhelpful
  // "Edge Function returned a non-2xx status code". The function does say
  // what went wrong — missing API key, wrong role, bad JSON from the model —
  // so read that off the response before falling back to the generic text.
  if (error) {
    const res = (error as { context?: Response }).context
    if (res && typeof res.json === 'function') {
      const body = await res.json().catch(() => null)
      if (body?.error) throw new Error(body.error)
    }
    throw new Error(error.message)
  }

  if (data?.error) throw new Error(data.error)
  if (!Array.isArray(data?.tasks)) throw new Error('The assistant returned an unexpected response.')

  // Normalise before returning, so nothing downstream has to know the model
  // answers in whatever language the rest of the brief was written in.
  return data.tasks.map((t: Record<string, unknown>) => ({
    ...t,
    priority: toPriority(t.priority),
  }))
}
