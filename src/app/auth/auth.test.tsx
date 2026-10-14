import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { statusFor } from '../../data/auth'
import { accounts, FakeAuthService, GOOD_CODE } from '../../test/fakeAuth'
import { renderApp, signedInOwner, signedInTv } from '../../test/renderApp'

// These run against a fake sign-in service. They check the screens and the
// routing; they prove nothing about real Supabase.

function fillPassword(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

async function enterCode(label: string, code: string, button: string) {
  fireEvent.change(await screen.findByLabelText(label), { target: { value: code } })
  fireEvent.click(screen.getByRole('button', { name: button }))
}

describe('which screen a session belongs to', () => {
  it('needs the authenticator code before the owner counts as signed in', () => {
    expect(statusFor({ role: 'owner', currentLevel: 'aal2', nextLevel: 'aal2' })).toBe('owner')
    expect(statusFor({ role: 'owner', currentLevel: 'aal1', nextLevel: 'aal2' })).toBe('needs-code')
    expect(statusFor({ role: 'owner', currentLevel: 'aal1', nextLevel: 'aal1' })).toBe('needs-enrolment')
  })

  it('treats the TV and unknown accounts separately', () => {
    expect(statusFor({ role: 'tv', currentLevel: 'aal1', nextLevel: 'aal1' })).toBe('tv')
    expect(statusFor({ role: undefined, currentLevel: 'aal2', nextLevel: 'aal2' })).toBe('unregistered')
    expect(statusFor({ role: 'admin', currentLevel: 'aal2', nextLevel: 'aal2' })).toBe('unregistered')
  })
})

describe('route guards', () => {
  it('sends a signed-out visitor to sign-in from every desktop page and the TV', async () => {
    for (const path of ['/', '/tasks', '/projects', '/tv', '/nowhere']) {
      const { unmount } = renderApp(path, new FakeAuthService())
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
      unmount()
    }
  })

  it('sends the TV sign-in to the TV display, never a desktop page', async () => {
    const { router } = renderApp('/tasks', signedInTv())
    await waitFor(() => expect(router.state.location.pathname).toBe('/tv'))
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('keeps an owner without a code away from every page', async () => {
    const service = new FakeAuthService({ account: accounts.owner, level: 'aal1' })
    const { router } = renderApp('/tasks', service)
    expect(await screen.findByRole('heading', { name: 'Enter your authenticator code' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('lets the owner preview the TV display', async () => {
    renderApp('/tv', signedInOwner())
    expect(await screen.findByText('Nothing needs your attention yet.')).toBeTruthy()
  })
})

describe('signing in', () => {
  it('shows a clear message for a wrong password', async () => {
    renderApp('/', new FakeAuthService())
    await screen.findByRole('heading', { name: 'Sign in' })
    fillPassword(accounts.owner.email, 'wrong')
    expect((await screen.findByRole('alert')).textContent).toBe('That email and password do not match.')
  })

  it('asks the owner for a code, refuses a wrong one, then opens the page they wanted', async () => {
    const { router } = renderApp('/tasks', new FakeAuthService())
    await screen.findByRole('heading', { name: 'Sign in' })
    fillPassword(accounts.owner.email, accounts.owner.password)

    await enterCode('Code', '000000', 'Verify')
    expect((await screen.findByRole('alert')).textContent).toContain('That code did not work')

    await enterCode('Code', GOOD_CODE, 'Verify')
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/tasks')
  })

  it('walks a new owner through authenticator set-up', async () => {
    renderApp('/', new FakeAuthService())
    await screen.findByRole('heading', { name: 'Sign in' })
    fillPassword(accounts.newOwner.email, accounts.newOwner.password)

    fireEvent.click(await screen.findByRole('button', { name: 'Show the QR code' }))
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeTruthy()
    expect(screen.getByText('FAKESECRET')).toBeTruthy()

    await enterCode('Code from the app', GOOD_CODE, 'Finish set-up')
    expect(await screen.findByRole('heading', { level: 1, name: 'Mission Control' })).toBeTruthy()
  })

  it('takes the TV sign-in straight to the TV display, with no code', async () => {
    const { router } = renderApp('/', new FakeAuthService())
    await screen.findByRole('heading', { name: 'Sign in' })
    fillPassword(accounts.tv.email, accounts.tv.password)
    await waitFor(() => expect(router.state.location.pathname).toBe('/tv'))
  })

  it('tells an unregistered account it has no access', async () => {
    renderApp('/', new FakeAuthService())
    await screen.findByRole('heading', { name: 'Sign in' })
    fillPassword(accounts.stranger.email, accounts.stranger.password)
    expect(await screen.findByRole('heading', { name: 'This account is not set up for Nexus.' })).toBeTruthy()
  })
})

describe('signing out and ended sessions', () => {
  it('signs out from the sidebar without calling it an ended session', async () => {
    const service = signedInOwner()
    renderApp('/', service)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(service.signOutCalls).toBe(1)
    expect(screen.queryByText(/Your session has ended/)).toBeNull()
  })

  it('says so when a session ends without signing out', async () => {
    const service = signedInOwner()
    renderApp('/', service)
    await screen.findByRole('heading', { level: 1, name: 'Mission Control' })

    act(() => service.endSession())

    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy()
  })
})

describe('without database settings', () => {
  it('explains that Nexus is not connected instead of showing any page', async () => {
    renderApp('/', null)
    expect(await screen.findByRole('heading', { name: /not connected to a database/ })).toBeTruthy()
  })
})
