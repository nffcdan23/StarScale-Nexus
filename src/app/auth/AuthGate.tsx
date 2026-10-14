import { StatusScreen } from '../../components/StatusScreen/StatusScreen'
import type { AuthState } from './authContext'

/** What to show while sign-in is not settled yet: loading, not set up, or failed. */
export function AuthGate({ state }: { state: Exclude<AuthState, { phase: 'ready' }> }) {
  if (state.phase === 'loading') return <StatusScreen title="Checking your sign-in…" />
  if (state.phase === 'not-configured') {
    return <StatusScreen title="Nexus is not connected to a database on this computer.">{state.problem}</StatusScreen>
  }
  return <StatusScreen title="Nexus could not check your sign-in.">{state.message}</StatusScreen>
}
