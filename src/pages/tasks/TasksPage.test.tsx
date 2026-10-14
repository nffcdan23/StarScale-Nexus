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

    fireEvent.change(await screen.findByLabelText('Context for the new task'), { target: { value: contexts[1].id } })
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
    const completed = await screen.findByRole('region', { name: 'Completed tasks' })
    expect(within(completed).getByText('Renew insurance')).toBeTruthy()
    expect(data.taskRows[0].status).toBe('done')

    fireEvent.click(within(completed).getByRole('checkbox', { name: 'Reopen “Renew insurance”' }))
    expect(await within(openList()).findByText('Renew insurance')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Completed tasks' })).toBeNull())
    expect(data.taskRows[0].completedAt).toBeNull()
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
