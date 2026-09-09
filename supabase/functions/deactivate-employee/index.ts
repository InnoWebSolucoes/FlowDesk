import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Deactivating somebody, and putting them back.
 *
 * Deleting is permanent and takes their history with it. When somebody has
 * simply left, the record of what they did is usually worth keeping, so this
 * stops them signing in and takes them off the lists people pick from while
 * leaving everything they did where it is.
 *
 * Two things have to move together: the ban, which is what actually stops the
 * password working, and users.is_active, which is what the app reads. Neither
 * on its own is enough — a ban alone leaves them looking present everywhere,
 * and a flag alone leaves the password working.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser()
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: callerProfile, error: profileErr } = await anonClient
      .from('users')
      .select('is_owner')
      .eq('id', caller.id)
      .single()

    if (profileErr || !callerProfile?.is_owner) {
      return new Response(JSON.stringify({ error: 'Forbidden: only the owner can do this' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { employeeId, active } = await req.json()
    if (!employeeId || typeof active !== 'boolean') {
      return new Response(JSON.stringify({ error: 'Missing employeeId or active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (employeeId === caller.id) {
      return new Response(JSON.stringify({ error: 'Cannot deactivate your own account' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // The flag first, through the function that refuses to touch the owner.
    // If this fails nothing has changed yet.
    const { error: flagErr } = await adminClient.rpc('set_user_active', {
      target: employeeId,
      active,
    })
    if (flagErr) {
      return new Response(JSON.stringify({ error: flagErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Then the ban. 'none' lifts it; a long duration is how Supabase expresses
    // "until somebody says otherwise".
    const { error: banErr } = await adminClient.auth.admin.updateUserById(employeeId, {
      ban_duration: active ? 'none' : '876000h', // 100 years
    })
    if (banErr) {
      // Put the flag back rather than leaving the two disagreeing: a person
      // marked inactive who can still sign in is the worse of the two states.
      await adminClient.rpc('set_user_active', { target: employeeId, active: !active })
      return new Response(JSON.stringify({ error: banErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
