import { supabase } from './supabaseClient'

/**
 * Task generation runs in the `generate-tasks` Edge Function, not here.
 *
 * The Anthropic key must never reach the browser: anything bundled into the
 * front end is readable by anyone who opens the deployed site, and the key
 * bills to our account. The function keeps it server-side and checks the
 * caller's session before spending anything.
 */
export async function generateTasks(
  description: string,
  /**
   * The batch already on screen. When present, `description` is read as
   * corrections to apply to these tasks rather than as a fresh brief, so a
   * manager can fix a typo or drop a task without re-describing the job.
   */
  currentTasks?: any[],
): Promise<any[]> {
  const { data, error } = await supabase.functions.invoke('generate-tasks', {
    body: currentTasks?.length ? { description, tasks: currentTasks } : { description },
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

  return data.tasks
}
