import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataError } from '../../data/types'
import { FakeData } from '../../test/fakeData'
import { renderApp, signedInOwner } from '../../test/renderApp'

// Mission Control against the in-memory fake database, at a fixed moment:
// Wednesday 14 October 2026, 2:30 PM London time. Only the date is fixed;
// timers run normally.

const card = (name: string) => screen.findByRole('region', { name })
/** Each timeline entry's text: time, title, then context. */
const entries = (region: HTMLElement) => within(region).queryAllByRole('listitem').map((item) => item.textContent)

function sampleData() {
  const data = new FakeData()
  const personal = data.addContext('Personal')
  const starscale = data.addContext('StarScale')
  data.addTask(starscale.id, 'File confirmation statement', { priority: 'high', deadline: { kind: 'date', date: '2026-10-13' } })
  data.addTask(personal.id, 'Call the bank', { priority: 'low', deadline: { kind: 'time', at: '2026-10-14T16:00:00Z' } })
  data.addTask(starscale.id, 'Investor update', { priority: 'high', deadline: { kind: 'date', date: '2026-10-14' } })
  data.addTask(personal.id, 'Renew insurance', { deadline: { kind: 'date', date: '2026-10-16' } })
  data.addTask(starscale.id, 'Team review', { deadline: { kind: 'time', at: '2026-10-16T08:00:00Z' } })
  data.addTask(personal.id, 'Book the MOT', { deadline: { kind: 'date', date: '2026-10-30' } })
  data.addTask(personal.id, 'Someday', { priority: 'low' })
  data.addTask(starscale.id, 'Done this week', { status: 'done', completedAt: '2026-10-13T10:00:00Z' })
  data.addTask(starscale.id, 'Done last week', { status: 'done', completedAt: '2026-10-09T10:00:00Z' })
  data.addTask(personal.id, 'Archived', { archivedAt: '2026-10-13T10:00:00Z' })
  return data
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T13:30:00Z'))
})

describe('Mission Control with live data', () => {
  it('sums up the day in the greeting panel', async () => {
    renderApp('/', signedInOwner(), sampleData())
    expect(await screen.findByRole('heading', { name: '1 overdue task and 2 due today.' })).toBeTruthy()
    expect(screen.getByText('7 open tasks in total, and 1 task completed since Monday.')).toBeTruthy()
    expect(screen.getByText('Updated 2:30 PM')).toBeTruthy()
  })

  it('lists overdue tasks first, then today\'s by priority', async () => {
    renderApp('/', signedInOwner(), sampleData())
    const today = await card('Today')
    await within(today).findByText('File confirmation statement')
    expect(within(today).getByText('1 overdue · 2 due today')).toBeTruthy()
    const items = within(today).getAllByRole('listitem')
    expect(items.map((item) => within(item).getByRole('checkbox').getAttribute('aria-label'))).toEqual([
      'Complete “File confirmation statement”',
      'Complete “Investor update”',
      'Complete “Call the bank”',
    ])
    expect(within(items[0]).getByText('Overdue · Yesterday')).toBeTruthy()
    expect(within(items[2]).getByText('Due Today, 5:00 PM')).toBeTruthy()
    expect(within(items[0]).getByText('High')).toBeTruthy()
  })

  it('shows the next seven days as a timeline, grouped by London day', async () => {
    renderApp('/', signedInOwner(), sampleData())
    const next = await card('Next Up')
    const friday = await within(next).findByRole('region', { name: 'Fri 16 Oct' })
    expect(entries(friday)).toEqual(['All dayRenew insurancePersonal', '9:00 AMTeam reviewStarScale'])
    // 30 October is more than seven days away.
    expect(within(next).queryByText('Book the MOT')).toBeNull()
  })

  it('counts open tasks and this week\'s completions per context', async () => {
    renderApp('/', signedInOwner(), sampleData())
    const contexts = await card('Contexts')
    expect(await within(contexts).findByText('4 open · 0 done this week')).toBeTruthy()
    expect(within(contexts).getByText('3 open · 1 done this week')).toBeTruthy()
  })

  it('completes a task from the Today card', async () => {
    const data = sampleData()
    renderApp('/', signedInOwner(), data)
    const today = await card('Today')
    fireEvent.click(await within(today).findByRole('checkbox', { name: 'Complete “Investor update”' }))

    await waitFor(() => expect(within(today).queryByText('Investor update')).toBeNull())
    expect(data.taskRows.find((task) => task.title === 'Investor update')?.status).toBe('done')
    expect(screen.getByRole('heading', { name: '1 overdue task and 1 due today.' })).toBeTruthy()
    expect(within(await card('Contexts')).getByText('2 open · 2 done this week')).toBeTruthy()
  })

  it('keeps the task and explains when completing fails', async () => {
    const data = sampleData()
    data.failNextWrite = new DataError('offline', 'Could not complete the task: Nexus cannot reach the database. Nothing was changed.')
    renderApp('/', signedInOwner(), data)
    const today = await card('Today')
    fireEvent.click(await within(today).findByRole('checkbox', { name: 'Complete “Investor update”' }))

    expect((await within(today).findByRole('alert')).textContent).toContain('cannot reach the database')
    expect(within(today).getByText('Investor update')).toBeTruthy()
    expect((within(today).getByRole('checkbox', { name: 'Complete “Investor update”' }) as HTMLInputElement).checked).toBe(false)
  })

  it('links to the open and completed task lists', async () => {
    const { router } = renderApp('/', signedInOwner(), sampleData())
    fireEvent.click(within(await card('Contexts')).getByRole('link', { name: 'View completed tasks' }))
    expect(await screen.findByRole('region', { name: 'Completed tasks' })).toBeTruthy()
    expect(router.state.location.search).toBe('?view=done')

    await act(() => router.navigate('/'))
    fireEvent.click(within(await card('Today')).getByRole('link', { name: 'View all open tasks' }))
    expect(await screen.findByRole('region', { name: 'Open tasks' })).toBeTruthy()
  })

  it('says plainly when there is nothing to show', async () => {
    renderApp('/', signedInOwner(), new FakeData())
    expect(await screen.findByRole('heading', { name: 'No open tasks.' })).toBeTruthy()
    expect(within(await card('Today')).getByText('Nothing overdue or due today.')).toBeTruthy()
    expect(within(await card('Next Up')).getByText('No deadlines in the next seven days.')).toBeTruthy()
    expect(within(await card('Contexts')).getByText('No open tasks and nothing completed this week.')).toBeTruthy()
  })
})

describe('Mission Control when refreshing fails', () => {
  it('keeps the last information on screen and says it may be out of date', async () => {
    const data = sampleData()
    renderApp('/', signedInOwner(), data)
    await screen.findByRole('heading', { name: '1 overdue task and 2 due today.' })

    data.failReads = new DataError('offline', 'Could not load your tasks: Nexus cannot reach the database. Nothing was changed.')
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain('Nexus cannot reach the database.')
    expect(notice.textContent).toContain('This shows information from 2:30 PM and may be out of date.')
    expect(screen.getByRole('heading', { name: '1 overdue task and 2 due today.' })).toBeTruthy()
    expect(within(await card('Today')).getByText('Investor update')).toBeTruthy()

    data.failReads = null
    fireEvent.click(within(notice).getByRole('button', { name: 'Try now' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('explains a first load that fails, and tries again on request', async () => {
    const data = sampleData()
    data.failReads = new DataError('offline', 'Could not load your contexts: Nexus cannot reach the database. Nothing was changed.')
    renderApp('/', signedInOwner(), data)

    expect(await screen.findByRole('heading', { name: 'Mission Control could not load your tasks.' })).toBeTruthy()
    expect(screen.getByText(/cannot reach the database/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull()

    data.failReads = null
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: '1 overdue task and 2 due today.' })).toBeTruthy()
  })

  it('returns to sign-in when the session has quietly ended', async () => {
    const service = signedInOwner()
    const data = sampleData()
    renderApp('/', service, data)
    await screen.findByRole('heading', { name: '1 overdue task and 2 due today.' })

    service.expireQuietly()
    data.failReads = new DataError('refused', 'Nexus refused to load your tasks. Your sign-in may have ended; sign in again and retry.')
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy()
  })
})
