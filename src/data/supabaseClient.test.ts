import { afterEach, describe, expect, it, vi } from 'vitest'

// The separate connection that checks the current password before a change,
// with Supabase's library replaced by a stand-in.

const signInWithPassword = vi.fn()
const signOut = vi.fn(async () => ({ error: null }))
const createClient = vi.fn((...args: [string, string, unknown]) => (args && { auth: { signInWithPassword, signOut } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: [string, string, unknown]) => createClient(...args) }))

const settings = { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_Fictional', environment: { kind: 'cloud' as const, projectRef: 'abcdefghijklmnopqrst' } }

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('checking the current password', () => {
  it('signs in on a connection that keeps nothing in the browser, then ends that session', async () => {
    const { createPasswordCheck } = await import('./supabaseClient')
    signInWithPassword.mockResolvedValueOnce({ data: {}, error: null })
    expect(await createPasswordCheck(settings)('owner@example.test', 'fictional password')).toBe('ok')
    const [, , options] = createClient.mock.calls[0] as [string, string, { auth: Record<string, unknown> }]
    expect(options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false })
    expect(options.auth.storageKey).not.toBe('sb-abcdefghijklmnopqrst-auth-token')
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(localStorage.length).toBe(0)
  })

  it('reports a wrong password and too many attempts, and passes other failures on', async () => {
    const { createPasswordCheck } = await import('./supabaseClient')
    const check = createPasswordCheck(settings)
    signInWithPassword.mockResolvedValueOnce({ data: {}, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } })
    expect(await check('owner@example.test', 'wrong')).toBe('wrong')
    signInWithPassword.mockResolvedValueOnce({ data: {}, error: { status: 429, message: 'Too many requests' } })
    expect(await check('owner@example.test', 'x')).toBe('rate-limited')
    signInWithPassword.mockResolvedValueOnce({ data: {}, error: { status: 500, message: 'Server trouble' } })
    await expect(check('owner@example.test', 'x')).rejects.toMatchObject({ message: 'Server trouble' })
    expect(signOut).not.toHaveBeenCalled()
  })
})
