import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createSupabaseAuthService } from './supabaseAuth'

// The Supabase-backed sign-in service, run against a stand-in client. This
// checks how replies are interpreted; only the Windows PC can check that
// Supabase really replies this way.

function serviceWith(auth: Record<string, unknown>) {
  return createSupabaseAuthService({ auth } as unknown as SupabaseClient)
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
