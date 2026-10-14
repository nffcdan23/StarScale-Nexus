import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataError } from '../../data/types'
import { FakeData } from '../../test/fakeData'
import { renderApp, signedInTv } from '../../test/renderApp'

// The TV dashboard against the in-memory fake database, at a fixed moment:
// Wednesday 14 October 2026, 2:30 PM London time. Only the date is fixed;
// timers run normally.
//
// The fake imitates the database's tv_summary() filtering so these tests can
// check what the screen does with a summary. The real filtering is done by
// PostgreSQL and proved by the security checks (TV-08 to TV-13, REAL-06).

const panel = (name: string) => screen.findByRole('region', { name })
const rowTexts = (region: HTMLElement) => within(region).queryAllByRole('listitem').map((item) => item.textContent)

function sampleData() {
  const data = new FakeData()
  const work = data.addContext('StarScale', true)
  const home = data.addContext('Home', true)
  const privateContext = data.addContext('Private', false)
  const oldContext = data.addContext('Old project', true)
  oldContext.archivedAt = '2026-10-01T10:00:00Z'

  data.addTask(work.id, 'File confirmation statement', { priority: 'high', deadline: { kind: 'date', date: '2026-10-13' } })
  data.addTask(work.id, 'Investor update', {
    priority: 'high',
    notes: 'SECRET NOTE',
    deadline: { kind: 'date', date: '2026-10-14' },
  })
  data.addTask(home.id, 'Call the bank', { priority: 'low', deadline: { kind: 'time', at: '2026-10-14T16:00:00Z' } })
  data.addTask(home.id, 'Renew insurance', { deadline: { kind: 'date', date: '2026-10-16' } })
  data.addTask(work.id, 'Team review', { deadline: { kind: 'time', at: '2026-10-15T08:00:00Z' } })
  data.addTask(work.id, 'Book the MOT', { deadline: { kind: 'date', date: '2026-10-30' } })
  data.addTask(home.id, 'Someday', { priority: 'low' })

  // None of these may reach the TV.
  data.addTask(work.id, 'Hidden from TV', { hideFromTv: true, deadline: { kind: 'date', date: '2026-10-14' } })
  data.addTask(privateContext.id, 'Private context task', { deadline: { kind: 'date', date: '2026-10-14' } })
  data.addTask(oldContext.id, 'Archived context task', { deadline: { kind: 'date', date: '2026-10-14' } })
  data.addTask(work.id, 'Finished task', { status: 'done', completedAt: '2026-10-13T10:00:00Z' })
  data.addTask(work.id, 'Archived task', { archivedAt: '2026-10-13T10:00:00Z', deadline: { kind: 'date', date: '2026-10-14' } })
  return data
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T13:30:00Z'))
})

describe('TV dashboard with live data', () => {
  it('shows the day, a clock, the greeting and a one-line summary', async () => {
    renderApp('/tv', signedInTv(), sampleData())
    expect(await screen.findByText('1 overdue task and 2 due today.')).toBeTruthy()
    expect(screen.getByText('Wednesday')).toBeTruthy()
    expect(screen.getByText('14 October')).toBeTruthy()
    expect(screen.getByText('2:30 PM')).toBeTruthy()
    expect(screen.getByText('Good afternoon.')).toBeTruthy()
    expect(screen.getByText('Updated 2:30 PM')).toBeTruthy()
  })

  it('shows only what the summary allows: no hidden, private, archived or completed tasks, and no notes', async () => {
    renderApp('/tv', signedInTv(), sampleData())
    await screen.findByText('Investor update')
    for (const title of ['Hidden from TV', 'Private context task', 'Archived context task', 'Finished task', 'Archived task']) {
      expect(screen.queryByText(title)).toBeNull()
    }
    expect(screen.queryByText(/SECRET NOTE/)).toBeNull()
    expect(screen.queryByText('Private')).toBeNull()
  })

  it('lists overdue tasks first, then what is due today, with priorities and deadlines', async () => {
    renderApp('/tv', signedInTv(), sampleData())
    const today = await panel('Today')
    await within(today).findByText('Investor update')
    expect(rowTexts(today)).toEqual([
      'File confirmation statementStarScale · Overdue · YesterdayHigh',
      'Investor updateStarScale · Due TodayHigh',
      'Call the bankHome · Due Today, 5:00 PMLow',
    ])
    expect(within(today).queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('shows up to four tasks in a panel and says how many more there are', async () => {
    const data = new FakeData()
    const work = data.addContext('StarScale', true)
    for (const title of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      data.addTask(work.id, title, { deadline: { kind: 'date', date: '2026-10-14' } })
    }
    renderApp('/tv', signedInTv(), data)
    const today = await panel('Today')
    await within(today).findByText('One')
    expect(within(today).getAllByRole('listitem')).toHaveLength(4)
    expect(within(today).getByText('and 2 more')).toBeTruthy()
  })

  it('shows the next seven days with the day and either a time or all day', async () => {
    renderApp('/tv', signedInTv(), sampleData())
    const next = await panel('Next Up')
    await within(next).findByText('Team review')
    expect(rowTexts(next)).toEqual(['Tomorrow9:00 AMTeam reviewStarScale', 'Fri 16 OctAll dayRenew insuranceHome'])
    expect(within(next).queryByText('Book the MOT')).toBeNull()
  })

  it('counts open tasks shown on the TV for each context, largest first', async () => {
    renderApp('/tv', signedInTv(), sampleData())
    const contexts = await panel('Open by context')
    await within(contexts).findByText('StarScale')
    expect(rowTexts(contexts)).toEqual(['StarScale4', 'Home3'])
  })

  it('says so calmly when there is nothing to show', async () => {
    renderApp('/tv', signedInTv(), new FakeData())
    expect(await screen.findByText('Nothing to show on the TV right now.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull()
  })

  it('reads only the TV summary, never the tasks or contexts tables', async () => {
    const data = sampleData()
    const refuse = () => {
      throw new Error('The TV must not read tables directly')
    }
    data.tasks = new Proxy(data.tasks, { get: refuse })
    data.contexts = new Proxy(data.contexts, { get: refuse })
    renderApp('/tv', signedInTv(), data)
    expect(await screen.findByText('Investor update')).toBeTruthy()
  })
})

describe('TV dashboard when refreshing fails', () => {
  it('keeps the last information on screen with a clear out-of-date warning, then recovers', async () => {
    const data = sampleData()
    renderApp('/tv', signedInTv(), data)
    await screen.findByText('Investor update')

    data.failReads = new DataError('offline', 'Could not load the summary: Nexus cannot reach the database. Nothing was changed.')
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByText('Offline. Showing information from 2:30 PM; it may be out of date.')).toBeTruthy()
    expect(screen.getByText('Investor update')).toBeTruthy()

    data.failReads = null
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByText('Updated 2:30 PM')).toBeTruthy()
  })

  it('explains a first load that fails, and shows the summary once it works', async () => {
    const data = sampleData()
    data.failReads = new DataError('offline', 'Could not load the summary: Nexus cannot reach the database. Nothing was changed.')
    renderApp('/tv', signedInTv(), data)
    expect(await screen.findByText('The TV cannot load its summary yet. It will keep trying.')).toBeTruthy()

    data.failReads = null
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByText('Investor update')).toBeTruthy()
  })

  it('returns to sign-in when the TV session has quietly ended', async () => {
    const service = signedInTv()
    const data = sampleData()
    renderApp('/tv', service, data)
    await screen.findByText('Investor update')

    service.expireQuietly()
    data.failReads = new DataError('refused', 'Nexus refused to load the summary. Your sign-in may have ended; sign in again and retry.')
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy()
  })
})

describe('TV settings menu', () => {
  const settingsButton = () => screen.getByRole('button', { name: 'TV settings' })

  it('opens from the keyboard, focuses its first option and closes with Escape', async () => {
    renderApp('/tv', signedInTv(), sampleData())
    await screen.findByText('Investor update')

    settingsButton().focus()
    fireEvent.click(settingsButton())
    expect(settingsButton().getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('group', { name: 'TV settings' })
    expect(document.activeElement).toBe(within(menu).getByRole('button', { name: 'Refresh now' }))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'TV settings' })).toBeNull()
    expect(document.activeElement).toBe(settingsButton())
  })

  it('refreshes now on request', async () => {
    const data = sampleData()
    const get = vi.spyOn(data.summary, 'get')
    renderApp('/tv', signedInTv(), data)
    await screen.findByText('Investor update')
    const before = get.mock.calls.length

    fireEvent.click(settingsButton())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }))
    await waitFor(() => expect(get.mock.calls.length).toBe(before + 1))
    expect(screen.queryByRole('group', { name: 'TV settings' })).toBeNull()
  })

  it('asks before signing out, and Cancel keeps the TV signed in', async () => {
    const service = signedInTv()
    renderApp('/tv', service, sampleData())
    await screen.findByText('Investor update')

    fireEvent.click(settingsButton())
    fireEvent.click(screen.getByRole('button', { name: 'Sign out…' }))
    expect(screen.getByText('Sign out this TV? It will need the TV password to sign in again.')).toBeTruthy()
    // The safe choice has the focus.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeTruthy()
    expect(service.signOutCalls).toBe(0)
  })

  it('signs the TV out after confirmation, without calling it an ended session', async () => {
    const service = signedInTv()
    renderApp('/tv', service, sampleData())
    await screen.findByText('Investor update')

    fireEvent.click(settingsButton())
    fireEvent.click(screen.getByRole('button', { name: 'Sign out…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(service.signOutCalls).toBe(1)
    expect(screen.queryByText(/Your session has ended/)).toBeNull()
  })
})
