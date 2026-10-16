import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError, statusFor, type AuthEvent, type AuthService } from './auth'

/**
 * Checks an email and password without touching the app's own sign-in
 * (see createPasswordCheck in supabaseClient.ts).
 */
export type PasswordCheck = (email: string, password: string) => Promise<'ok' | 'wrong' | 'rate-limited'>

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

const SESSION_GONE = new Set([
  'session_not_found',
  'session_expired',
  'bad_jwt',
  'no_authorization',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'user_not_found',
  'insufficient_aal',
])

function sessionEnded(): AuthError {
  return new AuthError('Your session has ended. Sign in again, then try again.', 'session-ended')
}

function isSessionGone(error: SupabaseErrorLike & { name?: string }): boolean {
  return error.name === 'AuthSessionMissingError' || SESSION_GONE.has(error.code ?? '') || error.status === 401
}

const WEAK_REASONS: Record<string, string> = {
  length: 'it is too short for this project',
  characters: 'it needs more kinds of characters for this project',
  pwned: 'it appears in a list of leaked passwords',
}

/** A refused password change, in words, with the reason the screen reacts to. */
function passwordChangeError(error: SupabaseErrorLike & { name?: string; reasons?: unknown }): AuthError {
  if (error.code === 'same_password') {
    return new AuthError('The new password must be different from your current one.', 'same-password')
  }
  if (error.code === 'weak_password') {
    const reasons = Array.isArray(error.reasons) ? error.reasons.map((reason) => WEAK_REASONS[reason] ?? reason) : []
    return new AuthError(
      `Supabase refused that password${reasons.length > 0 ? `: ${reasons.join('; ')}` : ''}. Choose another.`,
      'weak-password',
    )
  }
  if (['reauthentication_needed', 'reauth_nonce_missing', 'reauthentication_not_valid'].includes(error.code ?? '')) {
    return new AuthError(
      'For safety, Supabase wants a recent sign-in before a password change. Sign out, sign in again with your ' +
        'password and authenticator code, then change it straight away.',
      'reauthentication-needed',
    )
  }
  if (error.code === 'invalid_credentials') return new AuthError('Your current password is not right.', 'wrong-password')
  if (isSessionGone(error)) return sessionEnded()
  if (error.status === 429) return new AuthError('Too many attempts. Wait a few minutes, then try again.', 'rate-limited')
  return friendly(error, 'Could not change the password.')
}

function toQrCodeUrl(qrCode: string): string {
  return qrCode.startsWith('data:') ? qrCode : `data:image/svg+xml;utf8,${encodeURIComponent(qrCode)}`
}

/**
 * The sign-in service backed by Supabase Auth. checkPassword is needed only
 * for password changes; without it they are refused.
 */
export function createSupabaseAuthService(client: SupabaseClient, checkPassword?: PasswordCheck): AuthService {
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
      if (!session) return { status: 'signed-out', email: null, userId: null }

      const role = session.user.app_metadata?.nexus_role
      let currentLevel: string | null = null
      let nextLevel: string | null = null
      if (role === 'owner') {
        const levels = await auth.mfa.getAuthenticatorAssuranceLevel()
        if (levels.error) throw friendly(levels.error, 'Could not check your authenticator.')
        currentLevel = levels.data.currentLevel
        nextLevel = levels.data.nextLevel
      }
      return {
        status: statusFor({ role, currentLevel, nextLevel }),
        email: session.user.email ?? null,
        userId: session.user.id,
      }
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

    async accountDetails() {
      // Asks Supabase, rather than trusting the stored copy, so an ended
      // session shows as ended.
      const { data, error } = await auth.getUser()
      if (error || !data.user) throw error && !isSessionGone(error) ? friendly(error, 'Could not read your account.') : sessionEnded()
      const role = data.user.app_metadata?.nexus_role
      const factors = await auth.mfa.listFactors()
      if (factors.error) throw friendly(factors.error, 'Could not read your authenticator.')
      const levels = await auth.mfa.getAuthenticatorAssuranceLevel()
      if (levels.error) throw friendly(levels.error, 'Could not check your authenticator.')
      // listFactors puts only confirmed authenticator apps in "totp".
      const authenticator = factors.data.totp[0]
      return {
        email: data.user.email ?? null,
        role: role === 'owner' || role === 'tv' ? role : null,
        authenticatorVerified: Boolean(authenticator),
        authenticatorAddedAt: authenticator?.created_at ?? null,
        sessionUsedCode: levels.data.currentLevel === 'aal2',
      }
    },

    async changePassword(currentPassword, newPassword) {
      if (!checkPassword) throw new AuthError('Password changes are not available here.')
      const { data, error } = await auth.getSession()
      const email = data.session?.user.email
      if (error || !email) throw sessionEnded()

      // The current password is checked first, on a separate connection that
      // leaves this sign-in untouched, so an unlocked computer is not enough
      // to change it.
      let check: Awaited<ReturnType<PasswordCheck>>
      try {
        check = await checkPassword(email, currentPassword)
      } catch (failure) {
        throw friendly(failure as SupabaseErrorLike, 'Could not check your current password.')
      }
      if (check === 'wrong') throw new AuthError('Your current password is not right.', 'wrong-password')
      if (check === 'rate-limited') {
        throw new AuthError('Too many attempts. Wait a few minutes, then try again.', 'rate-limited')
      }

      // The account's own password update. Supabase also checks the current
      // password itself when the project is set to require it.
      const result = await auth.updateUser({ password: newPassword, current_password: currentPassword })
      if (result.error) throw passwordChangeError(result.error)
    },
  }
}
