import { createClient } from '@supabase/supabase-js'
import type { SupabaseSettings } from './config'

/**
 * The one Supabase connection the app uses. It holds only the publishable
 * key; everything else depends on the signed-in person's own session, which
 * Supabase keeps in this browser and refreshes before it expires.
 */
export function createSupabaseClient({ url, publishableKey }: SupabaseSettings) {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
}
