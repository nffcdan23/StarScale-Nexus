import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../app/auth/authContext'
import { AuthError, type AccountDetails } from '../../data/auth'

export type AccountDetailsState =
  | { status: 'loading' }
  | { status: 'ready'; details: AccountDetails }
  | { status: 'error'; message: string }

/** The signed-in account's details, read from Supabase when Settings opens. */
export function useAccountDetails(): { state: AccountDetailsState; reload: () => void } {
  const { actions } = useAuth()
  const [state, setState] = useState<AccountDetailsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    actions.accountDetails().then(
      (details) => {
        if (active) setState({ status: 'ready', details })
      },
      (error) => {
        if (!active) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        // An ended session is shown as ended, rather than as a broken page.
        if (error instanceof AuthError && error.reason === 'session-ended') void actions.recheck()
      },
    )
    return () => {
      active = false
    }
  }, [actions, attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])
  return { state, reload }
}
