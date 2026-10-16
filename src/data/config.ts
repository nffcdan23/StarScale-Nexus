import { environmentOf, type NexusEnvironment } from './environment'

export interface SupabaseSettings {
  url: string
  publishableKey: string
  environment: NexusEnvironment
}

export type SettingsResult =
  | { ok: true; settings: SupabaseSettings }
  | { ok: false; problem: string }

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

/**
 * Reads the two values the browser is allowed to know: the Supabase address
 * and its publishable key. Refuses anything that looks like a secret key, so
 * a mistake in a settings file cannot put one into the app, and any address
 * other than the local stack or a Supabase Cloud project.
 */
export function readSupabaseSettings(env: Record<string, unknown>): SettingsResult {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : ''
  const key =
    typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === 'string' ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim() : ''

  if (!url || !key) {
    return {
      ok: false,
      problem:
        'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set. Copy .env.example to .env.local and fill them in.',
    }
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad protocol')
  } catch {
    return { ok: false, problem: 'VITE_SUPABASE_URL is not a valid web address.' }
  }

  if (key.startsWith('sb_secret_') || decodeJwtPayload(key)?.role === 'service_role') {
    return {
      ok: false,
      problem:
        'VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key. Only the publishable key may be used in the app; replace it and restart.',
    }
  }

  const environment = environmentOf(url)
  if (!environment) {
    return {
      ok: false,
      problem:
        'VITE_SUPABASE_URL must be the local Supabase stack (port 54321 on this computer) or a Supabase Cloud project address.',
    }
  }
  if (environment.kind === 'cloud' && !key.startsWith('sb_publishable_')) {
    return { ok: false, problem: 'The cloud project needs its publishable key (sb_publishable_...).' }
  }

  return { ok: true, settings: { url: url.replace(/\/$/, ''), publishableKey: key, environment } }
}
