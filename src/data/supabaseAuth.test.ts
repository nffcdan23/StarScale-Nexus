import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AuthError } from './auth'
import { createSupabaseAuthService, type PasswordCheck } from './supabaseAuth'

// The Supabase-backed sign-in service, run against a stand-in client. This
// checks how replies are interpreted; only the Windows PC can check that
// Supabase really replies this way.

function serviceWith(auth: Record<string, unknown>, checkPassword?: PasswordCheck) {
  return createSupabaseAuthService({ auth } as unknown as SupabaseClient, checkPassword)
}

const session = (role: string | undefined) => ({
  data: { session: { user: { email: 'someone@example.test', app_metadata: role ? { nexus_role: role } : {} } } },
  error: null,
})

describe('createSupabaseAuthService', () => {
  it('reports no session as signed out', async () => {
    const service = serviceWith({ getSession: async () => ({ data: { session: null }, error: null }) })
    expect((await service.current()).status).toBe('signed-out')
  })

  it('asks for a code when the owner has an authenticator but only a password session', async () => {
    const service = serviceWith({
      getSession: async () => session('owner'),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null }) },
    })
    expect(await service.current()).toEqual({ status: 'needs-code', email: 'someone@example.test' })
  })

  it('recognises the TV without checking for an authenticator', async () => {
    const getAuthenticatorAssuranceLevel = vi.fn()
    const service = serviceWith({ getSession: async () => session('tv'), mfa: { getAuthenticatorAssuranceLevel } })
    expect((await service.current()).status).toBe('tv')
    expect(getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
  })

  it('turns a wrong password into a plain message', async () => {
    const service = serviceWith({
      signInWithPassword: async () => ({ error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } }),
    })
    await expect(service.signIn('a@example.test', 'x')).rejects.toThrow('That email and password do not match.')
  })

  it('explains when authenticator codes are switched off in the project settings', async () => {
    const service = serviceWith({
      mfa: {
        listFactors: async () => ({ data: { all: [], totp: [] }, error: null }),
        enroll: async () => ({ data: null, error: { code: 'mfa_totp_enroll_not_enabled', status: 422, message: 'disabled' } }),
      },
    })
    await expect(service.startEnrolment()).rejects.toThrow('switched off')
  })

  it('clears a half-finished set-up and returns a QR picture that is safe to show', async () => {
    const unenroll = vi.fn(async () => ({ error: null }))
    const service = serviceWith({
      mfa: {
        listFactors: async () => ({
          data: {
            all: [
              { id: 'old', factor_type: 'totp', status: 'unverified' },
              { id: 'keep', factor_type: 'totp', status: 'verified' },
            ],
            totp: [],
          },
          error: null,
        }),
        unenroll,
        enroll: async () => ({ data: { id: 'new', totp: { qr_code: '<svg></svg>', secret: 'SECRET' } }, error: null }),
      },
    })

    const enrolment = await service.startEnrolment()
    expect(unenroll).toHaveBeenCalledTimes(1)
    expect(unenroll).toHaveBeenCalledWith({ factorId: 'old' })
    expect(enrolment).toEqual({
      factorId: 'new',
      qrCodeUrl: 'data:image/svg+xml;utf8,%3Csvg%3E%3C%2Fsvg%3E',
      secret: 'SECRET',
    })
  })

  it('refuses a code when no authenticator is set up', async () => {
    const service = serviceWith({ mfa: { listFactors: async () => ({ data: { all: [], totp: [] }, error: null }) } })
    await expect(service.verifyCode('123456')).rejects.toThrow('No authenticator is set up')
  })

  it('signs out of this device only', async () => {
    const signOut = vi.fn(async () => ({ error: null }))
    await serviceWith({ signOut }).signOut()
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})

describe('changing the password (Settings)', () => {
  const signedIn = async () => ({ data: { session: { user: { email: 'owner@example.test' } } }, error: null })
  const reasonOf = async (attempt: Promise<unknown>) => {
    try {
      await attempt
    } catch (error) {
      return error instanceof AuthError ? { reason: error.reason, message: error.message } : { reason: 'not an AuthError' }
    }
    return { reason: 'no error' }
  }

  it('checks the current password first, then uses the account’s own update, sending only the password', async () => {
    const checkPassword = vi.fn<PasswordCheck>(async () => 'ok')
    const updateUser = vi.fn(async () => ({ data: { user: {} }, error: null }))
    const service = serviceWith({ getSession: signedIn, updateUser }, checkPassword)
    await service.changePassword('old fictional password', 'new fictional password')
    expect(checkPassword).toHaveBeenCalledWith('owner@example.test', 'old fictional password')
    expect(updateUser).toHaveBeenCalledTimes(1)
    expect(updateUser).toHaveBeenCalledWith({ password: 'new fictional password', current_password: 'old fictional password' })
    expect(checkPassword.mock.invocationCallOrder[0]).toBeLessThan(updateUser.mock.invocationCallOrder[0])
  })

  it('changes nothing when the current password is wrong', async () => {
    const updateUser = vi.fn()
    const service = serviceWith({ getSession: signedIn, updateUser }, async () => 'wrong')
    expect(await reasonOf(service.changePassword('wrong', 'new fictional password'))).toEqual({
      reason: 'wrong-password',
      message: 'Your current password is not right.',
    })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('reports an ended session without checking or changing anything', async () => {
    const checkPassword = vi.fn<PasswordCheck>()
    const updateUser = vi.fn()
    const service = serviceWith({ getSession: async () => ({ data: { session: null }, error: null }), updateUser }, checkPassword)
    expect((await reasonOf(service.changePassword('a', 'b'))).reason).toBe('session-ended')
    expect(checkPassword).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('turns each of Supabase’s refusals into a plain reason', async () => {
    const refusals: [Record<string, unknown>, string][] = [
      [{ code: 'same_password', status: 422, message: 'same' }, 'same-password'],
      [{ code: 'weak_password', status: 422, message: 'weak', reasons: ['pwned', 'length'] }, 'weak-password'],
      [{ code: 'reauthentication_needed', status: 400, message: 'reauth' }, 'reauthentication-needed'],
      [{ code: 'reauth_nonce_missing', status: 400, message: 'nonce' }, 'reauthentication-needed'],
      [{ code: 'invalid_credentials', status: 400, message: 'bad' }, 'wrong-password'],
      [{ name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' }, 'session-ended'],
      [{ code: 'session_not_found', status: 403, message: 'gone' }, 'session-ended'],
      [{ code: 'insufficient_aal', status: 403, message: 'aal' }, 'session-ended'],
      [{ status: 401, message: 'expired' }, 'session-ended'],
      [{ status: 429, message: 'slow down' }, 'rate-limited'],
    ]
    for (const [error, reason] of refusals) {
      const service = serviceWith({ getSession: signedIn, updateUser: async () => ({ data: { user: null }, error }) }, async () => 'ok')
      expect((await reasonOf(service.changePassword('old fictional password', 'new fictional password'))).reason, JSON.stringify(error)).toBe(reason)
    }
    const weak = serviceWith(
      { getSession: signedIn, updateUser: async () => ({ data: { user: null }, error: { code: 'weak_password', status: 422, message: 'weak', reasons: ['pwned'] } }) },
      async () => 'ok',
    )
    expect((await reasonOf(weak.changePassword('old', 'new fictional password'))).message).toContain('a list of leaked passwords')
  })

  it('never puts a password in a message', async () => {
    const service = serviceWith(
      { getSession: signedIn, updateUser: async () => ({ data: { user: null }, error: { status: 500, message: 'server trouble' } }) },
      async () => 'ok',
    )
    const { message } = await reasonOf(service.changePassword('old fictional password', 'new fictional password'))
    expect(message).not.toContain('fictional password')
  })

  it('refuses a password change when no password check is available', async () => {
    const service = serviceWith({ getSession: signedIn, updateUser: vi.fn() })
    await expect(service.changePassword('a', 'b')).rejects.toThrow('not available')
  })
})

describe('account details (Settings)', () => {
  const user = {
    id: 'internal-account-id',
    email: 'owner@example.test',
    app_metadata: { nexus_role: 'owner' },
  }

  it('reads the email, role and authenticator from Supabase, never the account id', async () => {
    const service = serviceWith({
      getUser: async () => ({ data: { user }, error: null }),
      mfa: {
        listFactors: async () => ({ data: { totp: [{ id: 'factor-id', created_at: '2026-10-16T13:41:00Z' }], all: [] }, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }),
      },
    })
    const details = await service.accountDetails()
    expect(details).toEqual({
      email: 'owner@example.test',
      role: 'owner',
      authenticatorVerified: true,
      authenticatorAddedAt: '2026-10-16T13:41:00Z',
      sessionUsedCode: true,
    })
    expect(JSON.stringify(details)).not.toMatch(/internal-account-id|factor-id/)
  })

  it('shows no authenticator when none is confirmed, and an ended session as ended', async () => {
    const none = serviceWith({
      getUser: async () => ({ data: { user: { ...user, app_metadata: { nexus_role: 'tv' } } }, error: null }),
      mfa: {
        listFactors: async () => ({ data: { totp: [], all: [] }, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
      },
    })
    expect(await none.accountDetails()).toMatchObject({ role: 'tv', authenticatorVerified: false, authenticatorAddedAt: null, sessionUsedCode: false })

    const ended = serviceWith({
      getUser: async () => ({ data: { user: null }, error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' } }),
    })
    await expect(ended.accountDetails()).rejects.toMatchObject({ reason: 'session-ended' })
  })
})
