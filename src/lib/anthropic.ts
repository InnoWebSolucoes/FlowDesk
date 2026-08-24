import { supabase } from './supabaseClient'

/**
 * Task generation runs in the `generate-tasks` Edge Function, not here.
 *
 * The Anthropic key must never reach the browser: anything bundled into the
 * front end is readable by anyone who opens the deployed site, and the key
 * bills to our account. The function keeps it server-side and checks the
 * caller's session before spending anything.
 */
export async function generateTasks(description: string): Promise<any[]> {
  const { data, error } = await supabase.functions.invoke('generate-tasks', {
    body: { description },
  })

  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  if (!Array.isArray(data?.tasks)) throw new Error('The assistant returned an unexpected response.')

  return data.tasks
}
