import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError, statusFor, type AuthEvent, type AuthService } from './auth'

interface SupabaseErrorLike {
  code?: string
  status?: number
  message: string
}

function friendly(error: SupabaseErrorLike, fallback: string): AuthError {
  if (error.code === 'invalid_credentials') return new AuthError('That email and password do not match.')
  if (error.code === 'mfa_verification_failed' || error.code === 'mfa_challenge_expired') {
    return new AuthError('That code did not work. Check your authenticator app and try again.')
  }
  if (error.code === 'mfa_totp_enroll_not_enabled' || error.code === 'mfa_totp_verify_not_enabled') {
    return new AuthError('Authenticator codes are switched off in this Supabase project’s settings.')
  }
  if (error.status === 429) return new AuthError('Too many attempts. Wait a few minutes, then try again.')
  return new AuthError(`${fallback} (${error.message})`)
}

function toQrCodeUrl(qrCode: string): string {
  return qrCode.startsWith('data:') ? qrCode : `data:image/svg+xml;utf8,${encodeURIComponent(qrCode)}`
}

/** The sign-in service backed by Supabase Auth. */
export function createSupabaseAuthService(client: SupabaseClient): AuthService {
  const auth = client.auth

  async function verifiedFactorId(): Promise<string> {
    const { data, error } = await auth.mfa.listFactors()
    if (error) throw friendly(error, 'Could not read your authenticator.')
    const factor = data.totp[0]
    if (!factor) throw new AuthError('No authenticator is set up for this account.')
    return factor.id
  }

  return {
    async current() {
      // Read from this browser's stored session. Good enough for choosing a
      // screen; the database checks the real token on every request.
      const { data, error } = await auth.getSession()
      if (error) throw friendly(error, 'Could not read your sign-in.')
      const session = data.session
      if (!session) return { status: 'signed-out', email: null }

      const role = session.user.app_metadata?.nexus_role
      let currentLevel: string | null = null
      let nextLevel: string | null = null
      if (role === 'owner') {
        const levels = await auth.mfa.getAuthenticatorAssuranceLevel()
        if (levels.error) throw friendly(levels.error, 'Could not check your authenticator.')
        currentLevel = levels.data.currentLevel
        nextLevel = levels.data.nextLevel
      }
      return { status: statusFor({ role, currentLevel, nextLevel }), email: session.user.email ?? null }
    },

    subscribe(listener) {
      const { data } = auth.onAuthStateChange((event) => {
        const mapped: AuthEvent =
          event === 'SIGNED_OUT' ? 'signed-out' : event === 'SIGNED_IN' ? 'signed-in' : 'changed'
        // Supabase advises against calling it again from inside this
        // callback, so hand the event over on the next tick.
        setTimeout(() => listener(mapped), 0)
      })
      return () => data.subscription.unsubscribe()
    },

    async signIn(email, password) {
      const { error } = await auth.signInWithPassword({ email, password })
      if (error) throw friendly(error, 'Sign-in failed.')
    },

    async verifyCode(code) {
      const factorId = await verifiedFactorId()
      const { error } = await auth.mfa.challengeAndVerify({ factorId, code })
      if (error) throw friendly(error, 'Could not check the code.')
    },

    async startEnrolment() {
      // Clear any half-finished set-up from an earlier attempt first.
      const existing = await auth.mfa.listFactors()
      if (existing.error) throw friendly(existing.error, 'Could not read your authenticators.')
      for (const factor of existing.data.all) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified') {
          await auth.mfa.unenroll({ factorId: factor.id })
        }
      }

      const { data, error } = await auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Nexus' })
      if (error) throw friendly(error, 'Could not start authenticator set-up.')
      return { factorId: data.id, qrCodeUrl: toQrCodeUrl(data.totp.qr_code), secret: data.totp.secret }
    },

    async finishEnrolment(factorId, code) {
      const { error } = await auth.mfa.challengeAndVerify({ factorId, code })
      if (error) throw friendly(error, 'Could not finish authenticator set-up.')
    },

    async signOut() {
      // This device only; other devices keep their own sessions.
      const { error } = await auth.signOut({ scope: 'local' })
      if (error) throw friendly(error, 'Could not sign out.')
    },
  }
}
