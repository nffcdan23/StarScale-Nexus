import { AuthError, statusFor, type AuthEvent, type AuthService, type AuthSnapshot } from '../data/auth'

// An in-memory stand-in for Supabase sign-in, so the screens can be tested on
// a machine with no Supabase at all. It imitates only the behaviour the
// screens depend on; it proves nothing about real Supabase.

export const GOOD_CODE = '123456'

interface FakeAccount {
  email: string
  password: string
  role: 'owner' | 'tv' | null
  hasAuthenticator: boolean
}

export const accounts = {
  owner: { email: 'owner@example.test', password: 'owner-password', role: 'owner', hasAuthenticator: true },
  newOwner: { email: 'new-owner@example.test', password: 'new-owner-password', role: 'owner', hasAuthenticator: false },
  tv: { email: 'tv@example.test', password: 'tv-password', role: 'tv', hasAuthenticator: false },
  stranger: { email: 'stranger@example.test', password: 'stranger-password', role: null, hasAuthenticator: false },
} satisfies Record<string, FakeAccount>

export class FakeAuthService implements AuthService {
  private accounts: FakeAccount[]
  private current_: { account: FakeAccount; level: 'aal1' | 'aal2' } | null = null
  private listeners = new Set<(event: AuthEvent) => void>()
  signOutCalls = 0

  constructor(signedInAs?: { account: FakeAccount; level: 'aal1' | 'aal2' }) {
    this.accounts = Object.values(accounts).map((account) => ({ ...account }))
    if (signedInAs) {
      const account = this.accounts.find((entry) => entry.email === signedInAs.account.email)!
      this.current_ = { account, level: signedInAs.level }
    }
  }

  async current(): Promise<AuthSnapshot> {
    if (!this.current_) return { status: 'signed-out', email: null }
    const { account, level } = this.current_
    return {
      status: statusFor({
        role: account.role,
        currentLevel: level,
        nextLevel: account.hasAuthenticator ? 'aal2' : 'aal1',
      }),
      email: account.email,
    }
  }

  subscribe(listener: (event: AuthEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: AuthEvent) {
    for (const listener of this.listeners) listener(event)
  }

  async signIn(email: string, password: string) {
    const account = this.accounts.find((entry) => entry.email === email && entry.password === password)
    if (!account) throw new AuthError('That email and password do not match.')
    this.current_ = { account, level: 'aal1' }
    this.emit('signed-in')
  }

  async verifyCode(code: string) {
    if (!this.current_?.account.hasAuthenticator) throw new AuthError('No authenticator is set up for this account.')
    if (code !== GOOD_CODE) throw new AuthError('That code did not work. Check your authenticator app and try again.')
    this.current_.level = 'aal2'
    this.emit('changed')
  }

  async startEnrolment() {
    if (!this.current_) throw new AuthError('Not signed in.')
    return { factorId: 'fake-factor', qrCodeUrl: 'data:image/svg+xml;utf8,%3Csvg%2F%3E', secret: 'FAKESECRET' }
  }

  async finishEnrolment(factorId: string, code: string) {
    if (!this.current_ || factorId !== 'fake-factor') throw new AuthError('Set-up was not started.')
    if (code !== GOOD_CODE) throw new AuthError('That code did not work. Check your authenticator app and try again.')
    this.current_.account.hasAuthenticator = true
    this.current_.level = 'aal2'
    this.emit('changed')
  }

  async signOut() {
    this.signOutCalls += 1
    this.current_ = null
    this.emit('signed-out')
  }

  /** Imitates a session that expired or could not be refreshed. */
  endSession() {
    this.current_ = null
    this.emit('signed-out')
  }
}
