import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider } from '../app/auth/AuthProvider'
import { DataProvider } from '../app/data/DataProvider'
import { routes } from '../app/routes'
import { accounts, FakeAuthService } from './fakeAuth'
import { FakeData } from './fakeData'

/** Renders the whole app at an address, with the fake sign-in service and fake database. */
export function renderApp(path: string, service: FakeAuthService | null = signedInOwner(), data = new FakeData()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <AuthProvider service={service} configProblem={service ? null : 'No settings in this test.'}>
      <DataProvider services={service ? data : null}>
        <RouterProvider router={router} />
      </DataProvider>
    </AuthProvider>,
  )
  return { ...view, router, service, data }
}

export const signedInOwner = () => new FakeAuthService({ account: accounts.owner, level: 'aal2' })
export const signedInTv = () => new FakeAuthService({ account: accounts.tv, level: 'aal1' })
