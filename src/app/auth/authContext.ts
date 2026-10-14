import { createContext, useContext } from 'react'
import type { AuthSnapshot, Enrolment } from '../../data/auth'

export type AuthState =
  | { phase: 'not-configured'; problem: string }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  /** sessionEnded is true when a session stopped without the owner signing out. */
  | { phase: 'ready'; snapshot: AuthSnapshot; sessionEnded: boolean }

export interface AuthActions {
  signIn(email: string, password: string): Promise<void>
  verifyCode(code: string): Promise<void>
  startEnrolment(): Promise<Enrolment>
  finishEnrolment(factorId: string, code: string): Promise<void>
  signOut(): Promise<void>
  /**
   * Reads the sign-in again, for when the database refuses a request. If the
   * session has quietly ended, the app shows that it has.
   */
  recheck(): Promise<void>
}

export interface AuthContextValue {
  state: AuthState
  actions: AuthActions
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
