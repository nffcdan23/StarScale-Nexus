import { describe, expect, it } from 'vitest'
import { authStorageKey, environmentOf } from './environment'

// A fictional project id: it belongs to no real project.
const ref = 'abcdefghijklmnopqrst'

describe('which database a build connects to', () => {
  it('recognises the local stack and a cloud project, and nothing else', () => {
    expect(environmentOf('http://127.0.0.1:54321')).toEqual({ kind: 'local' })
    expect(environmentOf('http://localhost:54321/')).toEqual({ kind: 'local' })
    expect(environmentOf(`https://${ref}.supabase.co`)).toEqual({ kind: 'cloud', projectRef: ref })
    for (const other of [
      'http://127.0.0.1:3000',
      'https://127.0.0.1:54321',
      `http://${ref}.supabase.co`,
      'https://short.supabase.co',
      `https://${ref}.supabase.co.example.com`,
      `https://${ref}.supabase.co/rest/v1`,
      'https://example.com',
      '',
    ]) {
      expect(environmentOf(other), other).toBeNull()
    }
  })

  it('keeps the local and cloud sign-in sessions under different names', () => {
    expect(authStorageKey('http://127.0.0.1:54321')).toBe('sb-127-auth-token')
    expect(authStorageKey(`https://${ref}.supabase.co`)).toBe(`sb-${ref}-auth-token`)
  })
})
