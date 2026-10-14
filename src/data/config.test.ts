import { describe, expect, it } from 'vitest'
import { readSupabaseSettings } from './config'

const url = 'http://127.0.0.1:54321'

function jwtWithRole(role: string) {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '')
  return `${encode({ alg: 'HS256' })}.${encode({ role })}.signature`
}

describe('readSupabaseSettings', () => {
  it('accepts an address and a publishable key', () => {
    const result = readSupabaseSettings({ VITE_SUPABASE_URL: `${url}/`, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })
    expect(result).toEqual({ ok: true, settings: { url, publishableKey: 'sb_publishable_abc' } })
  })

  it('reports missing settings', () => {
    expect(readSupabaseSettings({}).ok).toBe(false)
    expect(readSupabaseSettings({ VITE_SUPABASE_URL: url }).ok).toBe(false)
  })

  it('refuses a secret key of either kind', () => {
    for (const key of ['sb_secret_abc', jwtWithRole('service_role')]) {
      const result = readSupabaseSettings({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key })
      expect(result.ok).toBe(false)
    }
  })

  it('accepts an older-style public key', () => {
    const result = readSupabaseSettings({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: jwtWithRole('anon') })
    expect(result.ok).toBe(true)
  })

  it('refuses an address that is not a web address', () => {
    expect(readSupabaseSettings({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }).ok).toBe(false)
  })
})
