// What the app needs from a sign-in service, kept separate from Supabase so
// screens and tests do not depend on it. The real version is supabaseAuth.ts.
//
// None of this is a security boundary. It only decides which screen to show.
// The database refuses every request that is not from the owner with an
// authenticator code, or from a registered TV calling its summary.

export type AuthStatus =
  /** No one is signed in. */
  | 'signed-out'
  /** The owner entered a password and has an authenticator, but no code yet. */
  | 'needs-code'
  /** The owner entered a password and has not set up an authenticator yet. */
  | 'needs-enrolment'
  /** The owner, with an authenticator code. */
  | 'owner'
  /** The TV display. */
  | 'tv'
  /** Signed in, but the account is not marked as the owner or a TV. */
  | 'unregistered'

export interface AuthSnapshot {
  status: AuthStatus
  email: string | null
}

export interface Enrolment {
  factorId: string
  /** A picture of the QR code, safe to use as an image address. */
  qrCodeUrl: string
  /** The same secret as text, for typing into an authenticator by hand. */
  secret: string
}

export type AuthEvent = 'signed-in' | 'signed-out' | 'changed'

export interface AuthService {
  current(): Promise<AuthSnapshot>
  subscribe(listener: (event: AuthEvent) => void): () => void
  signIn(email: string, password: string): Promise<void>
  verifyCode(code: string): Promise<void>
  startEnrolment(): Promise<Enrolment>
  finishEnrolment(factorId: string, code: string): Promise<void>
  signOut(): Promise<void>
}

/** A failure whose message is already fit to show to the owner. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Which screen a session belongs to. "role" is the label the administrator
 * set on the account; the levels are Supabase's assurance levels (aal1 after
 * a password, aal2 after an authenticator code).
 */
export function statusFor(session: {
  role: unknown
  currentLevel: string | null
  nextLevel: string | null
}): AuthStatus {
  if (session.role === 'tv') return 'tv'
  if (session.role !== 'owner') return 'unregistered'
  if (session.currentLevel === 'aal2') return 'owner'
  return session.nextLevel === 'aal2' ? 'needs-code' : 'needs-enrolment'
}
