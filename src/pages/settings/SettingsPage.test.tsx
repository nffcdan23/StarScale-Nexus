import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthError } from '../../data/auth'
import { drafts } from '../../features/notes/drafts'
import { accounts, FakeAuthService } from '../../test/fakeAuth'
import { renderApp, signedInOwner, signedInTv } from '../../test/renderApp'

// Settings against the fake sign-in service: the screens, the rules and the
// routing. They prove nothing about real Supabase (see supabaseAuth.test.ts
// and the Windows checks).

const NEW_PASSWORD = 'fictional mountain lantern'

function fillPasswordForm(current: string, next: string, confirm = next) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } })
  fireEvent.change(screen.getByLabelText('Type the new password again'), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
}

async function openSecurity(service = signedInOwner()) {
  const view = renderApp('/settings?section=security', service)
  await screen.findByRole('form', { name: 'Change password' })
  return view
}

describe('Settings navigation', () => {
  it('sits just above Sign out in the sidebar and opens My Account', async () => {
    const { router } = renderApp('/')
    const settings = await screen.findByRole('link', { name: 'Settings' })
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    expect(settings.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(settings.parentElement).toBe(signOut.parentElement)

    fireEvent.click(settings)
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/settings')
    expect(screen.getByRole('heading', { name: 'My Account', level: 2 })).toBeTruthy()
    expect(settings.getAttribute('aria-current')).toBe('page')
  })

  it('moves between the five sections, keeping the choice in the address', async () => {
    const { router } = renderApp('/settings')
    const sections = within(await screen.findByRole('navigation', { name: 'Settings sections' }))
    expect(sections.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'My Account',
      'Security',
      'Preferences',
      'Data & Privacy',
      'About Nexus',
    ])
    for (const [name, query] of [
      ['Security', '?section=security'],
      ['Preferences', '?section=preferences'],
      ['Data & Privacy', '?section=privacy'],
      ['About Nexus', '?section=about'],
    ]) {
      fireEvent.click(sections.getByRole('link', { name }))
      expect(await screen.findByRole('heading', { name, level: 2 })).toBeTruthy()
      expect(router.state.location.search).toBe(query)
      expect(sections.getByRole('link', { name }).getAttribute('aria-current')).toBe('page')
    }
  })

  it('treats an unknown section as My Account', async () => {
    renderApp('/settings?section=nonsense')
    expect(await screen.findByRole('heading', { name: 'My Account', level: 2 })).toBeTruthy()
  })
})

describe('who can open Settings', () => {
  it('never the TV: it is sent to the TV display', async () => {
    const { router } = renderApp('/settings', signedInTv())
    await waitFor(() => expect(router.state.location.pathname).toBe('/tv'))
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull()
    expect(screen.queryByLabelText('Current password')).toBeNull()
  })

  it('never an owner without an authenticator code', async () => {
    const { router } = renderApp('/settings?section=security', new FakeAuthService({ account: accounts.owner, level: 'aal1' }))
    expect(await screen.findByRole('heading', { name: 'Enter your authenticator code' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('never someone signed out', async () => {
    renderApp('/settings', new FakeAuthService())
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })
})

describe('My Account', () => {
  it('shows the email, a fixed role and how this session signed in, and no ids or tokens', async () => {
    const { container } = renderApp('/settings')
    expect(await screen.findByText(accounts.owner.email)).toBeTruthy()
    expect(screen.getByText('Owner')).toBeTruthy()
    expect(screen.getByText('Set by the administrator; it cannot be changed here.')).toBeTruthy()
    expect(screen.getByText('With your password and authenticator code, on this computer.')).toBeTruthy()
    expect(container.textContent).not.toContain(`fake-${accounts.owner.email}`)
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0)
  })

  it('works with the local database in this build (the cloud wording is checked in describe.test.ts)', async () => {
    renderApp('/settings')
    expect(await screen.findByText('Local Supabase on the Windows PC (development and testing)')).toBeTruthy()
  })
})

describe('Security: changing the password', () => {
  it('changes it after checking the current one, then clears the form and says so', async () => {
    const service = signedInOwner()
    await openSecurity(service)
    fillPasswordForm(accounts.owner.password, NEW_PASSWORD)
    expect((await screen.findByRole('status')).textContent).toContain('Password changed.')
    expect(service.passwordChanges).toBe(1)
    for (const label of ['Current password', 'New password', 'Type the new password again']) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('')
    }
    // Still signed in, on the same page.
    expect(screen.getByRole('heading', { name: 'Security', level: 2 })).toBeTruthy()
  })

  it('refuses a wrong current password and changes nothing', async () => {
    const service = signedInOwner()
    await openSecurity(service)
    fillPasswordForm('not-the-password', NEW_PASSWORD)
    expect(await screen.findByText('Your current password is not right.')).toBeTruthy()
    expect(service.passwordChanges).toBe(0)
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('')
    expect(screen.getByLabelText('Current password').getAttribute('aria-invalid')).toBe('true')
  })

  it('checks the new password before sending anything', async () => {
    const service = signedInOwner()
    await openSecurity(service)
    const cases: [string, string, string, string][] = [
      ['', NEW_PASSWORD, NEW_PASSWORD, 'Enter your current password.'],
      [accounts.owner.password, '', '', 'Enter a new password.'],
      [accounts.owner.password, 'too short', 'too short', 'Use at least 12 characters.'],
      [accounts.owner.password, ` ${NEW_PASSWORD}`, ` ${NEW_PASSWORD}`, 'Remove the space at the start or end.'],
      [accounts.owner.password, 'x'.repeat(73), 'x'.repeat(73), 'That is too long: use at most 72 characters, fewer if it has accents or symbols.'],
      [accounts.owner.password, NEW_PASSWORD, `${NEW_PASSWORD}!`, 'The two new passwords do not match.'],
      ['same-password-twice', 'same-password-twice', 'same-password-twice', 'Choose a password different from your current one.'],
    ]
    for (const [current, next, confirm, message] of cases) {
      fillPasswordForm(current, next, confirm)
      expect(await screen.findByText(message)).toBeTruthy()
    }
    expect(service.passwordChanges).toBe(0)
  })

  it('shows Supabase refusing a weak password against the new password', async () => {
    const service = signedInOwner()
    service.refuseNextPasswordChange = new AuthError(
      'Supabase refused that password: it appears in a list of leaked passwords. Choose another.',
      'weak-password',
    )
    await openSecurity(service)
    fillPasswordForm(accounts.owner.password, NEW_PASSWORD)
    expect(await screen.findByText(/it appears in a list of leaked passwords/)).toBeTruthy()
    expect(screen.getByLabelText('New password').getAttribute('aria-invalid')).toBe('true')
    expect(service.passwordChanges).toBe(0)
  })

  it('explains when Supabase wants a recent sign-in first', async () => {
    const service = signedInOwner()
    service.refuseNextPasswordChange = new AuthError(
      'For safety, Supabase wants a recent sign-in before a password change. Sign out, sign in again with your password and authenticator code, then change it straight away.',
      'reauthentication-needed',
    )
    await openSecurity(service)
    fillPasswordForm(accounts.owner.password, NEW_PASSWORD)
    expect((await screen.findByRole('alert')).textContent).toContain('wants a recent sign-in')
    expect(service.passwordChanges).toBe(0)
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('')
  })

  it('shows an ended session as ended, instead of changing anything', async () => {
    const service = signedInOwner()
    const { router } = await openSecurity(service)
    act(() => service.expireQuietly())
    fillPasswordForm(accounts.owner.password, NEW_PASSWORD)
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(await screen.findByText(/session has ended/i)).toBeTruthy()
    expect(service.passwordChanges).toBe(0)
  })

  it('never puts a password in the address or in browser storage', async () => {
    const { router } = await openSecurity()
    fillPasswordForm(accounts.owner.password, NEW_PASSWORD)
    await screen.findByRole('status')
    const stored = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join('\n')
    for (const secret of [accounts.owner.password, NEW_PASSWORD]) {
      expect(stored).not.toContain(secret)
      expect(`${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}`).not.toContain(secret)
    }
    expect(screen.getByLabelText('New password').getAttribute('type')).toBe('password')
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText('Current password').getAttribute('autocomplete')).toBe('current-password')
  })
})

describe('Security: authenticator', () => {
  it('shows a set-up, confirmed authenticator and when it was added, with no way to remove it here', async () => {
    await openSecurity()
    expect(await screen.findByText('Set up and confirmed')).toBeTruthy()
    expect(screen.getByText('16 October 2026, 2:41 PM')).toBeTruthy()
    expect(screen.getByText(/Replacing or removing the authenticator is not available inside Nexus yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /remove|reset|disable/i })).toBeNull()
  })
})

describe('Preferences, Data & Privacy, About', () => {
  it('Preferences offers nothing that does not work', async () => {
    const { container } = renderApp('/settings?section=preferences')
    expect(await screen.findByText(/There is nothing to set here yet/)).toBeTruthy()
    expect(container.querySelectorAll('main input, main select, main textarea, section button')).toHaveLength(0)
  })

  it('Data & Privacy explains saved data, unsaved copies and the sign-in, with no delete or reset', async () => {
    renderApp('/settings?section=privacy')
    expect(await screen.findByRole('heading', { name: 'Saved in Nexus' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Unsaved changes on this computer' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your sign-in on this computer' })).toBeTruthy()
    expect(screen.getByText('No notes have unsaved changes kept here.')).toBeTruthy()
    expect(screen.getByText('Web browser')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /delete|reset|clear|erase/i })).toBeNull()
  })

  it('Data & Privacy counts the unsaved notes kept on this computer', async () => {
    const draft = (noteId: string) => ({
      ownerId: `fake-${accounts.owner.email}`,
      noteId,
      isNew: false,
      baseRevision: 1,
      title: 'Fictional',
      contextId: null,
      content: { type: 'doc' as const, content: [] },
      changedAt: '2026-10-17T10:00:00.000Z',
      held: false,
    })
    drafts.write(draft('note-1'))
    drafts.write(draft('note-2'))
    renderApp('/settings?section=privacy')
    expect(await screen.findByText('2 notes have unsaved changes kept here.')).toBeTruthy()
  })

  it('About shows the version and this copy of Nexus', async () => {
    renderApp('/settings?section=about')
    expect(await screen.findByText('0.1.0')).toBeTruthy()
    expect(screen.getByText('Nexus by StarScale.')).toBeTruthy()
  })
})
