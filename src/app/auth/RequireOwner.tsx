import { Navigate, Outlet, useLocation } from 'react-router'
import { AuthGate } from './AuthGate'
import { useAuth } from './authContext'

/**
 * Shows the desktop pages only to the owner with an authenticator code.
 * This only chooses screens; the database enforces the same rule itself.
 */
export function RequireOwner() {
  const { state } = useAuth()
  const location = useLocation()

  if (state.phase !== 'ready') return <AuthGate state={state} />
  const { status } = state.snapshot
  if (status === 'owner') return <Outlet />
  if (status === 'tv') return <Navigate to="/tv" replace />
  return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />
}
