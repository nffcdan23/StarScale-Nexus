import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { navigation } from './navigation'
import { routes } from './routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

describe('desktop shell', () => {
  it('lists exactly the three working sections in the sidebar', () => {
    renderAt('/')

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)

    expect(labels).toEqual(['Mission Control', 'Tasks', 'Projects'])
  })

  it('opens Mission Control at the root address and marks it as current', () => {
    renderAt('/')

    expect(screen.getByRole('heading', { level: 1, name: 'Mission Control' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Mission Control' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('moves between pages and updates which section is current', async () => {
    renderAt('/')

    fireEvent.click(screen.getByRole('link', { name: 'Tasks' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page')
    expect(
      screen.getByRole('link', { name: 'Mission Control' }).getAttribute('aria-current'),
    ).toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'Projects' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Projects' }).getAttribute('aria-current')).toBe('page')
  })

  it('has a working page behind every sidebar entry', () => {
    for (const entry of navigation.flatMap((group) => group.entries)) {
      const { unmount } = renderAt(entry.path)
      expect(screen.getByRole('heading', { level: 1, name: entry.label })).toBeTruthy()
      unmount()
    }
  })

  it('shows a not-found page for an unknown address', () => {
    renderAt('/nowhere')

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Mission Control' })).toBeTruthy()
  })
})

describe('Mission Control', () => {
  it('greets by time of day and shows the date and a clock that keeps time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 13, 8, 5, 30))
    renderAt('/')

    expect(screen.getByText('Good morning.')).toBeTruthy()
    expect(screen.getByText('Tuesday 13 October 2026')).toBeTruthy()
    expect(screen.getByText('8:05 AM')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('8:06 AM')).toBeTruthy()
  })
})

describe('TV dashboard', () => {
  it('shows the date, time and greeting with no sidebar, links or buttons', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 13, 20, 42, 0))
    renderAt('/tv')

    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryAllByRole('button')).toHaveLength(0)

    expect(screen.getByText('Tuesday')).toBeTruthy()
    expect(screen.getByText('13 October')).toBeTruthy()
    expect(screen.getByText('8:42 PM')).toBeTruthy()
    expect(screen.getByText('Good evening.')).toBeTruthy()
  })
})
