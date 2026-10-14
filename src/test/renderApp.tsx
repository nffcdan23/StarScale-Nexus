import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '../app/auth/AuthProvider'
import { routes } from '../app/routes'
import { accounts, FakeAuthService } from './fakeAuth'

/** Renders the whole app at an address, with the fake sign-in service. */
export function renderApp(path: string, service: FakeAuthService | null = signedInOwner()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <AuthProvider service={service} configProblem={service ? null : 'No settings in this test.'}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return { ...view, router, service }
}

export const signedInOwner = () => new FakeAuthService({ account: accounts.owner, level: 'aal2' })
export const signedInTv = () => new FakeAuthService({ account: accounts.tv, level: 'aal1' })
