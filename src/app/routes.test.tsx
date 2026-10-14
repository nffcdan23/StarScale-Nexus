import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderApp, signedInTv } from '../test/renderApp'
import { navigation } from './navigation'

// Sign-in is settled asynchronously, so these use the "find" queries, which wait.

describe('desktop shell (signed in as the owner with a code)', () => {
  it('lists exactly the three working sections in the sidebar', async () => {
    renderApp('/')

    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)

    expect(labels).toEqual(['Mission Control', 'Tasks', 'Projects'])
  })

  it('opens Mission Control at the root address and marks it as current', async () => {
    renderApp('/')

    expect(await screen.findByRole('heading', { level: 1, name: 'Mission Control' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Mission Control' }).getAttribute('aria-current')).toBe('page')
  })

  it('moves between pages and updates which section is current', async () => {
    renderApp('/')

    fireEvent.click(await screen.findByRole('link', { name: 'Tasks' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Mission Control' }).getAttribute('aria-current')).toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'Projects' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Projects' }).getAttribute('aria-current')).toBe('page')
  })

  it('has a working page behind every sidebar entry', async () => {
    for (const entry of navigation.flatMap((group) => group.entries)) {
      const { unmount } = renderApp(entry.path)
      expect(await screen.findByRole('heading', { level: 1, name: entry.label })).toBeTruthy()
      unmount()
    }
  })

  it('shows a not-found page for an unknown address', async () => {
    renderApp('/nowhere')

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Mission Control' })).toBeTruthy()
  })
})

describe('Mission Control', () => {
  it('greets by time of day and shows the date and a clock that keeps time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 9, 13, 8, 5, 30))
    renderApp('/')

    expect(await screen.findByText('Good morning.')).toBeTruthy()
    expect(screen.getByText('Tuesday 13 October 2026')).toBeTruthy()
    expect(screen.getByText('8:05 AM')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('8:06 AM')).toBeTruthy()
  })
})

describe('TV dashboard (signed in as the TV)', () => {
  it('shows the date, time and greeting with no sidebar or links, and only the settings button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 9, 13, 20, 42, 0))
    renderApp('/tv', signedInTv())

    expect(await screen.findByText('8:42 PM')).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['TV settings'])
    expect(screen.getByText('Tuesday')).toBeTruthy()
    expect(screen.getByText('13 October')).toBeTruthy()
    expect(screen.getByText('Good evening.')).toBeTruthy()
  })
})
