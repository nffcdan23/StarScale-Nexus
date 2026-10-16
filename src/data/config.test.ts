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
    expect(result).toEqual({ ok: true, settings: { url, publishableKey: 'sb_publishable_abc', environment: { kind: 'local' } } })
  })

  it('accepts a cloud project with its publishable key, and knows it is the cloud', () => {
    const cloud = 'https://abcdefghijklmnopqrst.supabase.co'
    const result = readSupabaseSettings({ VITE_SUPABASE_URL: cloud, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })
    expect(result).toEqual({
      ok: true,
      settings: { url: cloud, publishableKey: 'sb_publishable_abc', environment: { kind: 'cloud', projectRef: 'abcdefghijklmnopqrst' } },
    })
    expect(readSupabaseSettings({ VITE_SUPABASE_URL: cloud, VITE_SUPABASE_PUBLISHABLE_KEY: jwtWithRole('anon') }).ok).toBe(false)
  })

  it('refuses any address that is not the local stack or a cloud project', () => {
    for (const other of ['https://example.com', 'http://127.0.0.1:3000', 'https://abc.supabase.co']) {
      const result = readSupabaseSettings({ VITE_SUPABASE_URL: other, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })
      expect(result.ok, other).toBe(false)
    }
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
