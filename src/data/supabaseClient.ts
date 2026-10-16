import { createClient } from '@supabase/supabase-js'
import type { SupabaseSettings } from './config'
import { authStorageKey } from './environment'
import type { PasswordCheck } from './supabaseAuth'

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
      // One session per database: local and cloud sign-ins never share one.
      storageKey: authStorageKey(url),
    },
  })
}

/**
 * Checks an email and password without touching the app's own sign-in: a
 * separate connection that keeps nothing in the browser (its session lives
 * only in memory) signs in, and that session is ended again at once. Used
 * only to confirm the current password before a password change.
 */
export function createPasswordCheck({ url, publishableKey }: SupabaseSettings): PasswordCheck {
  return async (email, password) => {
    const checker = createClient(url, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `${authStorageKey(url)}-password-check`,
      },
    })
    const { error } = await checker.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.code === 'invalid_credentials') return 'wrong'
      if (error.status === 429) return 'rate-limited'
      throw error
    }
    // End the check's own session on the server; the app's sign-in is separate.
    await checker.auth.signOut({ scope: 'local' }).catch(() => {})
    return 'ok'
  }
}
