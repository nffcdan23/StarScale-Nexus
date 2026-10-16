import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AuthError, type AuthService } from '../../data/auth'
import { AuthContext, type AuthActions, type AuthState } from './authContext'

interface AuthProviderProps {
  /** Null when the app has no Supabase settings on this computer. */
  service: AuthService | null
  configProblem?: string | null
  children: ReactNode
}

/** Keeps track of who is signed in and offers the sign-in actions to every screen. */
export function AuthProvider({ service, configProblem = null, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(() =>
    service
      ? { phase: 'loading' }
      : { phase: 'not-configured', problem: configProblem ?? 'Nexus has no database settings.' },
  )

  // True from the moment the owner chooses to sign out until the next
  // sign-in, so a deliberate sign-out is never reported as an ended session.
  const signingOut = useRef(false)

  const reload = useCallback(
    async (sessionEnded = false) => {
      if (!service) return
      try {
        const snapshot = await service.current()
        setState({ phase: 'ready', snapshot, sessionEnded: sessionEnded && snapshot.status === 'signed-out' })
      } catch (error) {
        setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    },
    [service],
  )

  useEffect(() => {
    if (!service) return
    let active = true

    service.current().then(
      (snapshot) => {
        if (active) setState({ phase: 'ready', snapshot, sessionEnded: false })
      },
      (error) => {
        if (active) setState({ phase: 'error', message: String(error?.message ?? error) })
      },
    )

    const unsubscribe = service.subscribe((event) => {
      if (!active) return
      if (event === 'signed-in') signingOut.current = false
      // A sign-out nobody asked for: the session expired, could not be
      // refreshed, or was ended from another device.
      void reload(event === 'signed-out' && !signingOut.current)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [service, reload])

  const actions = useMemo<AuthActions>(() => {
    const require = () => {
      if (!service) throw new AuthError('Nexus has no database settings on this computer.')
      return service
    }
    return {
      async signIn(email, password) {
        signingOut.current = false
        await require().signIn(email, password)
        await reload()
      },
      async verifyCode(code) {
        await require().verifyCode(code)
        await reload()
      },
      startEnrolment: () => require().startEnrolment(),
      async finishEnrolment(factorId, code) {
        await require().finishEnrolment(factorId, code)
        await reload()
      },
      async signOut() {
        signingOut.current = true
        await require().signOut()
        await reload()
      },
      recheck: () => reload(!signingOut.current),
      accountDetails: () => require().accountDetails(),
      async changePassword(currentPassword, newPassword) {
        try {
          await require().changePassword(currentPassword, newPassword)
        } catch (error) {
          // Read the sign-in again, so an ended session shows as ended.
          if (error instanceof AuthError && error.reason === 'session-ended') await reload(!signingOut.current)
          throw error
        }
      },
    }
  }, [service, reload])

  const value = useMemo(() => ({ state, actions }), [state, actions])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
