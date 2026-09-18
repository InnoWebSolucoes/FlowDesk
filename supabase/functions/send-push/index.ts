// Delivers one notification row to the phones of the people it is for.
//
// Called by the notification_push database trigger with { notification_id }.
// The row is re-read here with the service role, so the caller's body decides
// nothing but which row; the words, the audience and the link all come from
// the table.
//
// Secrets (Project -> Edge Functions -> Secrets):
//   VAPID_KEYS   the JSON key pair from supabase/functions/send-push.secrets.local
//   VAPID_EMAIL  a contact address the push services can reach if the sender
//                misbehaves (any real inbox)
//
// Web Push itself is done by @negrel/webpush, which is pure Web Crypto, so
// nothing Node-only is needed in the Deno runtime.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.5.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Where tapping the notification lands. The app itself sends /admin or
 * /employee visitors to the right place from "/", so the paths here only
 * need to carry what the bell would open.
 */
function linkFor(row: {
  conversation_id: string | null
  task_id: string | null
  entry_id: string | null
  target_role: string | null
}) {
  const base = row.target_role === 'admin' ? '/admin' : '/employee'
  if (row.conversation_id) return `${base}/chat?conversation=${row.conversation_id}`
  // A manager's work log lives on the author's profile, which this does not
  // know from here — the bell resolves that. Their own log is a real page.
  if (row.entry_id) return row.target_role === 'admin' ? '/admin/projects' : '/employee/work-log'
  if (row.task_id) return row.target_role === 'admin' ? '/admin/projects' : '/employee/tasks'
  return '/'
}

let server: webpush.ApplicationServer | null = null
async function appServer() {
  if (server) return server
  const exported = JSON.parse(Deno.env.get('VAPID_KEYS') ?? 'null')
  if (!exported) throw new Error('VAPID_KEYS secret is not set')
  const vapidKeys = await webpush.importVapidKeys(exported, { extractable: false })
  server = await webpush.ApplicationServer.new({
    contactInformation: 'mailto:' + (Deno.env.get('VAPID_EMAIL') ?? 'innowebsolucoes@gmail.com'),
    vapidKeys,
  })
  return server
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { notification_id } = await req.json()
    if (typeof notification_id !== 'string') return json({ error: 'notification_id required' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: row, error } = await admin
      .from('notifications')
      .select('id, title, message, task_id, conversation_id, entry_id, target_user_id, target_role')
      .eq('id', notification_id)
      .single()
    if (error || !row) return json({ error: 'No such notification' }, 404)

    // Who it is for: one person, or every manager when it is aimed at the role.
    let userIds: string[] = []
    if (row.target_user_id) {
      userIds = [row.target_user_id]
    } else if (row.target_role === 'admin') {
      const { data: admins } = await admin.from('users').select('id').eq('role', 'admin')
      userIds = (admins ?? []).map((u) => u.id)
    }
    if (userIds.length === 0) return json({ sent: 0 })

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .in('user_id', userIds)
    if (!subs || subs.length === 0) return json({ sent: 0 })

    const payload = JSON.stringify({
      title: row.title,
      body: row.message,
      url: linkFor(row),
    })

    const push = await appServer()
    let sent = 0
    const dead: string[] = []
    await Promise.all(
      subs.map(async (s) => {
        const subscriber = push.subscribe({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        })
        try {
          await subscriber.pushTextMessage(payload, {})
          sent++
        } catch (e) {
          // 404/410 is the push service saying the device unsubscribed —
          // the app was removed, or notifications turned off in settings.
          // Drop it so it is not retried on every notification from now on.
          const status = (e as { response?: Response })?.response?.status
          if (status === 404 || status === 410) dead.push(s.endpoint)
          else console.error('push failed', s.endpoint, e)
        }
      }),
    )
    if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)

    return json({ sent, dropped: dead.length })
  } catch (e) {
    console.error(e)
    return json({ error: (e as Error).message }, 500)
  }
})
