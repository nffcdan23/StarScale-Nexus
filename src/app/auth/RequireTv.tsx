import { Navigate, Outlet } from 'react-router'
import { AuthGate } from './AuthGate'
import { useAuth } from './authContext'

/** The TV display is for the TV sign-in, and for the owner to preview it. */
export function RequireTv() {
  const { state } = useAuth()

  if (state.phase !== 'ready') return <AuthGate state={state} />
  const { status } = state.snapshot
  if (status === 'tv' || status === 'owner') return <Outlet />
  return <Navigate to="/sign-in" replace state={{ from: '/tv' }} />
}
