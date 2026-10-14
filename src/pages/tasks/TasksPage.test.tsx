import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataError } from '../../data/types'
import { FakeData } from '../../test/fakeData'
import { renderApp, signedInOwner } from '../../test/renderApp'

// The Tasks page against the in-memory fake database. These check the
// screens; the database rules are checked by the security suite.

function withContexts(...names: string[]) {
  const data = new FakeData()
  const contexts = names.map((name) => data.addContext(name))
  return { data, contexts }
}

async function addTask(title: string) {
  fireEvent.change(await screen.findByLabelText('New task'), { target: { value: title } })
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
}

const openList = () => screen.getByRole('region', { name: 'Open tasks' })
const showList = async (name: 'Open' | 'Completed' | 'Archived') =>
  fireEvent.click(within(await screen.findByRole('group', { name: 'Show tasks' })).getByRole('button', { name }))

async function openEditor(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Edit “${title}”` }))
  return screen.getByRole('form', { name: `Edit “${title}”` })
}

const rowOf = async (title: string) => (await screen.findByText(title)).closest('li')!

describe('Tasks page', () => {
  it('asks for a first context before any task can be added', async () => {
    renderApp('/tasks', signedInOwner(), new FakeData())
    expect(await screen.findByRole('heading', { name: 'Create a context first.' })).toBeTruthy()
    expect(screen.queryByLabelText('New task')).toBeNull()
  })

  it('creates a first context, then allows tasks', async () => {
    const { data } = renderApp('/tasks', signedInOwner(), new FakeData())
    fireEvent.change(await screen.findByLabelText('New context name'), { target: { value: 'Personal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add context' }))

    expect(await screen.findByLabelText('New task')).toBeTruthy()
    expect(data.contextRows.map((context) => context.name)).toEqual(['Personal'])
  })

  it('adds a task to the chosen context and lists it with its priority', async () => {
    const { data, contexts } = withContexts('Personal', 'StarScale')
    renderApp('/tasks', signedInOwner(), data)

    await screen.findByRole('option', { name: 'StarScale' })
    fireEvent.change(screen.getByLabelText('Context for the new task'), { target: { value: contexts[1].id } })
    await addTask('File the accounts')

    const row = (await within(openList()).findByText('File the accounts')).closest('li')!
    expect(within(row).getByText('StarScale')).toBeTruthy()
    expect(within(row).getByText('Medium')).toBeTruthy()
    expect(data.taskRows[0].contextId).toBe(contexts[1].id)
    expect((screen.getByLabelText('New task') as HTMLInputElement).value).toBe('')
  })

  it('keeps the typed title and explains when saving fails', async () => {
    const { data } = withContexts('Personal')
    data.failNextWrite = new DataError('offline', 'Could not add the task: Nexus cannot reach the database. Nothing was changed.')
    renderApp('/tasks', signedInOwner(), data)

    await addTask('Call the garage')

    expect((await screen.findByRole('alert')).textContent).toContain('cannot reach the database')
    expect((screen.getByLabelText('New task') as HTMLInputElement).value).toBe('Call the garage')
    expect(data.taskRows).toHaveLength(0)
  })

  it('completes a task, then reopens it', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Renew insurance')
    renderApp('/tasks', signedInOwner(), data)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete “Renew insurance”' }))
    expect(await within(openList()).findByText('Nothing open. Add a task above.')).toBeTruthy()
    expect(data.taskRows[0].status).toBe('done')

    await showList('Completed')
    const completed = await screen.findByRole('region', { name: 'Completed tasks' })
    fireEvent.click(await within(completed).findByRole('checkbox', { name: 'Reopen “Renew insurance”' }))
    expect(await within(completed).findByText('No completed tasks yet.')).toBeTruthy()
    expect(data.taskRows[0].completedAt).toBeNull()

    await showList('Open')
    expect(await within(openList()).findByText('Renew insurance')).toBeTruthy()
  })

  it('lists open tasks with high priority first', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Low one', { priority: 'low' })
    data.addTask(contexts[0].id, 'High one', { priority: 'high' })
    data.addTask(contexts[0].id, 'Medium one')
    renderApp('/tasks', signedInOwner(), data)

    await screen.findByText('High one')
    const titles = within(openList())
      .getAllByRole('listitem')
      .map((item) => item.querySelector('span')?.textContent)
    expect(titles).toEqual(['High one', 'Medium one', 'Low one'])
  })
})

describe('Task filters', () => {
  it('shows open, completed and archived tasks separately', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Still to do')
    data.addTask(contexts[0].id, 'Finished', { status: 'done', completedAt: '2026-10-14T10:00:00Z' })
    data.addTask(contexts[0].id, 'Put away', { archivedAt: '2026-10-14T11:00:00Z' })
    renderApp('/tasks', signedInOwner(), data)

    const titles = async (region: string) => {
      const list = await screen.findByRole('region', { name: region })
      await within(list).findAllByRole('listitem')
      return within(list).getAllByRole('listitem').map((item) => item.querySelector('span')?.textContent)
    }

    expect(await titles('Open tasks')).toEqual(['Still to do'])
    await showList('Completed')
    expect(await titles('Completed tasks')).toEqual(['Finished'])
    await showList('Archived')
    expect(await titles('Archived tasks')).toEqual(['Put away'])
    expect(within(screen.getByRole('group', { name: 'Show tasks' })).getByRole('button', { name: 'Archived' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('returns to the open list when a task is added from another list', async () => {
    const { data } = withContexts('Personal')
    renderApp('/tasks', signedInOwner(), data)
    await showList('Archived')
    await screen.findByText('No archived tasks.')

    await addTask('Book the MOT')
    expect(await within(await screen.findByRole('region', { name: 'Open tasks' })).findByText('Book the MOT')).toBeTruthy()
  })
})

describe('Task editor', () => {
  it('edits the title and notes', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Renew insurnce')
    renderApp('/tasks', signedInOwner(), data)

    const editor = await openEditor('Renew insurnce')
    fireEvent.change(within(editor).getByLabelText('Title'), { target: { value: 'Renew insurance' } })
    fireEvent.change(within(editor).getByLabelText('Notes'), { target: { value: 'Policy ends 1 November.\nCompare three quotes.' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    const row = await rowOf('Renew insurance')
    expect(within(row).getByText('Policy ends 1 November.')).toBeTruthy()
    expect(data.taskRows[0].title).toBe('Renew insurance')
    expect(data.taskRows[0].notes).toBe('Policy ends 1 November.\nCompare three quotes.')
  })

  it('changes the priority, which reorders the open list', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'First')
    data.addTask(contexts[0].id, 'Second')
    renderApp('/tasks', signedInOwner(), data)

    const editor = await openEditor('Second')
    fireEvent.change(within(editor).getByLabelText('Priority'), { target: { value: 'high' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(await within(await rowOf('Second')).findByText('High')).toBeTruthy()
    const titles = within(openList()).getAllByRole('listitem').map((item) => item.querySelector('span')?.textContent)
    expect(titles).toEqual(['Second', 'First'])
    expect(data.taskRows[1].priority).toBe('high')
  })

  it('sets a date-only deadline', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'File the accounts')
    renderApp('/tasks', signedInOwner(), data)

    const editor = await openEditor('File the accounts')
    fireEvent.change(within(editor).getByLabelText('Deadline date'), { target: { value: '2030-03-15' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(await within(await rowOf('File the accounts')).findByText('Due Fri 15 Mar 2030')).toBeTruthy()
    expect(data.taskRows[0].deadline).toEqual({ kind: 'date', date: '2030-03-15' })
  })

  it('sets a deadline with a time, then changes it to date-only', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Call the bank')
    renderApp('/tasks', signedInOwner(), data)

    let editor = await openEditor('Call the bank')
    expect((within(editor).getByLabelText('Deadline time') as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(within(editor).getByLabelText('Deadline date'), { target: { value: '2030-03-15' } })
    fireEvent.change(within(editor).getByLabelText('Deadline time'), { target: { value: '09:30' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(await within(await rowOf('Call the bank')).findByText('Due Fri 15 Mar 2030, 9:30 AM')).toBeTruthy()
    // London is on GMT in mid-March, so 9:30 AM is 9:30 UTC.
    expect(data.taskRows[0].deadline).toEqual({ kind: 'time', at: '2030-03-15T09:30:00.000Z' })

    editor = await openEditor('Call the bank')
    expect((within(editor).getByLabelText('Deadline time') as HTMLInputElement).value).toBe('09:30')
    fireEvent.change(within(editor).getByLabelText('Deadline time'), { target: { value: '' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(await within(await rowOf('Call the bank')).findByText('Due Fri 15 Mar 2030')).toBeTruthy()
    expect(data.taskRows[0].deadline).toEqual({ kind: 'date', date: '2030-03-15' })
  })

  it('clears a deadline', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Pay invoice', { deadline: { kind: 'date', date: '2030-03-15' } })
    renderApp('/tasks', signedInOwner(), data)

    const editor = await openEditor('Pay invoice')
    fireEvent.click(within(editor).getByRole('button', { name: 'Clear deadline' }))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(data.taskRows[0].deadline).toBeNull())
    expect(within(await rowOf('Pay invoice')).queryByText(/Due/)).toBeNull()
  })

  it('marks a missed deadline as overdue', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Old deadline', { deadline: { kind: 'date', date: '2020-01-01' } })
    renderApp('/tasks', signedInOwner(), data)

    expect(await within(await rowOf('Old deadline')).findByText('Overdue · Wed 1 Jan 2020')).toBeTruthy()
  })

  it('moves a task to another context', async () => {
    const { data, contexts } = withContexts('Personal', 'StarScale')
    data.addTask(contexts[0].id, 'Send invoice')
    renderApp('/tasks', signedInOwner(), data)

    const editor = await openEditor('Send invoice')
    fireEvent.change(within(editor).getByLabelText('Context'), { target: { value: contexts[1].id } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(await within(await rowOf('Send invoice')).findByText('StarScale')).toBeTruthy()
    expect(data.taskRows[0].contextId).toBe(contexts[1].id)
  })

  it('hides a task from the TV', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Private errand')
    renderApp('/tasks', signedInOwner(), data)

    const editor = await openEditor('Private errand')
    fireEvent.click(within(editor).getByRole('switch', { name: 'Hide from TV' }))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(await within(await rowOf('Private errand')).findByText(/Hidden from TV/)).toBeTruthy()
    expect(data.taskRows[0].hideFromTv).toBe(true)
  })

  it('cancels without saving anything', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Leave me')
    renderApp('/tasks', signedInOwner(), data)

    const editor = await openEditor('Leave me')
    fireEvent.change(within(editor).getByLabelText('Title'), { target: { value: 'Changed' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('button', { name: 'Edit “Leave me”' })).toBeTruthy()
    expect(data.taskRows[0].title).toBe('Leave me')
  })

  it('keeps the editor open with the changes when saving fails', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Try to save')
    data.failNextWrite = new DataError('refused', 'Nexus refused to save the task. Your sign-in may have ended; sign in again and retry.')
    renderApp('/tasks', signedInOwner(), data)

    const editor = await openEditor('Try to save')
    fireEvent.change(within(editor).getByLabelText('Title'), { target: { value: 'Saved title' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

    expect((await within(editor).findByRole('alert')).textContent).toContain('Nexus refused to save the task')
    expect((within(editor).getByLabelText('Title') as HTMLInputElement).value).toBe('Saved title')
    expect(data.taskRows[0].title).toBe('Try to save')
  })

  it('archives a task and restores it from the archived list', async () => {
    const { data, contexts } = withContexts('Personal')
    data.addTask(contexts[0].id, 'Someday maybe')
    renderApp('/tasks', signedInOwner(), data)

    const editor = await openEditor('Someday maybe')
    fireEvent.click(within(editor).getByRole('button', { name: 'Archive task' }))
    expect(await within(openList()).findByText('Nothing open. Add a task above.')).toBeTruthy()
    expect(data.taskRows[0].archivedAt).not.toBeNull()

    await showList('Archived')
    const archived = await screen.findByRole('region', { name: 'Archived tasks' })
    expect(within(archived).queryByRole('checkbox')).toBeNull()
    fireEvent.click(await within(archived).findByRole('button', { name: 'Restore “Someday maybe”' }))
    expect(await within(archived).findByText('No archived tasks.')).toBeTruthy()
    expect(data.taskRows[0].archivedAt).toBeNull()

    await showList('Open')
    expect(await within(openList()).findByText('Someday maybe')).toBeTruthy()
  })
})

describe('Contexts manager', () => {
  it('switches a context on for the TV', async () => {
    const { data } = withContexts('StarScale')
    renderApp('/tasks', signedInOwner(), data)

    const toggle = await screen.findByRole('switch', { name: 'Show StarScale on TV' })
    expect((toggle as HTMLInputElement).checked).toBe(false)
    fireEvent.click(toggle)
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Show StarScale on TV' }) as HTMLInputElement).checked).toBe(true))
    expect(data.contextRows[0].showOnTv).toBe(true)
  })

  it('renames a context', async () => {
    const { data } = withContexts('Persnal')
    renderApp('/tasks', signedInOwner(), data)

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Persnal' }))
    fireEvent.change(screen.getByLabelText('New name for Persnal'), { target: { value: 'Personal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('button', { name: 'Rename Personal' })).toBeTruthy()
    expect(data.contextRows[0].name).toBe('Personal')
  })

  it('archives a context, keeps its tasks labelled, and restores it', async () => {
    const { data, contexts } = withContexts('Personal', 'Old project')
    data.addTask(contexts[1].id, 'Leftover task')
    renderApp('/tasks', signedInOwner(), data)

    fireEvent.click(await screen.findByRole('button', { name: 'Archive Old project' }))

    expect(await screen.findByRole('button', { name: 'Restore Old project' })).toBeTruthy()
    expect(await within(openList()).findByText('Old project (archived)')).toBeTruthy()
    const options = within(screen.getByLabelText('Context for the new task')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Personal'])

    fireEvent.click(screen.getByRole('button', { name: 'Restore Old project' }))
    expect(await screen.findByRole('button', { name: 'Archive Old project' })).toBeTruthy()
  })

  it('shows a refusal from the database plainly', async () => {
    const { data } = withContexts('Personal')
    data.failNextWrite = new DataError('refused', 'Nexus refused to change the TV setting. Your sign-in may have ended; sign in again and retry.')
    renderApp('/tasks', signedInOwner(), data)

    fireEvent.click(await screen.findByRole('switch', { name: 'Show Personal on TV' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Nexus refused')
    expect(data.contextRows[0].showOnTv).toBe(false)
  })
})
