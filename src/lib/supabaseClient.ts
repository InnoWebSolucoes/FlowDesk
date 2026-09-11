import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Stated rather than defaulted: staying signed in between visits is what
    // the phone depends on, and it should not change with a library update.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
