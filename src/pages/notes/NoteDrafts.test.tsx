import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataError } from '../../data/types'
import { drafts } from '../../features/notes/drafts'
import { accounts } from '../../test/fakeAuth'
import { FakeData, paragraphDoc } from '../../test/fakeData'
import { renderApp, signedInOwner } from '../../test/renderApp'

// Unsaved changes kept on this computer (Phase 3c-2), against the fake
// database and the browser's real local storage (jsdom).

const OWNER = `fake-${accounts.owner.email}`
const offline = () => new DataError('offline', 'Could not save the note: Nexus cannot reach the database. Nothing was changed.')

const noteText = () => screen.getByLabelText('Note text')
const titleBox = () => screen.getByLabelText('Title') as HTMLInputElement
const saveNow = () => fireEvent.click(screen.getByRole('button', { name: 'Save now' }))
const status = () => within(screen.getByRole('region', { name: 'Note' })).getAllByRole('status')[0].textContent

async function open(data: FakeData, path: string) {
  const view = renderApp(path, signedInOwner(), data)
  await screen.findByLabelText('Note text')
  return view
}

describe('keeping unsaved changes on this computer', () => {
  it('keeps changes that cannot be saved, says so, and marks the note in the list', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans', text: 'Text' })
    data.failWrites = offline()
    await open(data, `/notes/${note.id}`)

    fireEvent.change(titleBox(), { target: { value: 'Plans, offline' } })
    saveNow()
    await waitFor(() => expect(status()).toBe('Offline: kept on this computer. Will save when connected.'))
    expect(drafts.read(OWNER, note.id)).toMatchObject({ title: 'Plans, offline', baseRevision: 1, isNew: false })
    expect(await screen.findByText('Unsaved changes on this computer')).toBeTruthy()
  })

  it('never removes the copy until the database confirms the save', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    data.failWrites = offline()
    await open(data, `/notes/${note.id}`)
    fireEvent.change(titleBox(), { target: { value: 'Changed' } })
    saveNow()
    await waitFor(() => expect(status()).toMatch(/^Offline: kept/))
    expect(drafts.read(OWNER, note.id)).not.toBeNull()

    data.failWrites = null
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(status()).toMatch(/^Saved /))
    expect(data.noteRows[0].title).toBe('Changed')
    expect(drafts.read(OWNER, note.id)).toBeNull()
    expect(screen.queryByText('Unsaved changes on this computer')).toBeNull()
  })

  it('keeps edits made while a save is on its way, based on the new revision', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    const save = data.notes.save
    let release: () => void = () => {}
    data.notes.save = (id, changes, base) =>
      new Promise((resolve, reject) => {
        release = () => save(id, changes, base).then(resolve, reject)
      })
    await open(data, `/notes/${note.id}`)

    fireEvent.change(titleBox(), { target: { value: 'First edit' } })
    saveNow()
    await waitFor(() => expect(status()).toBe('Saving…'))
    fireEvent.change(titleBox(), { target: { value: 'First edit, then more' } })
    await act(async () => release())

    await waitFor(() => expect(drafts.read(OWNER, note.id)).toMatchObject({ title: 'First edit, then more', baseRevision: 2 }))
    expect(data.noteRows[0]).toMatchObject({ title: 'First edit', revision: 2 })
  })
})

describe('restoring after the browser closes', () => {
  it('brings back unsaved changes and saves them once the database can be reached', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans', text: 'Saved text' })
    data.failWrites = offline()
    const first = await open(data, `/notes/${note.id}`)
    fireEvent.change(titleBox(), { target: { value: 'Written before the crash' } })
    // The browser closes before any save gets through.
    first.unmount()
    expect(drafts.read(OWNER, note.id)?.title).toBe('Written before the crash')

    data.failWrites = null
    await open(data, `/notes/${note.id}`)
    expect(titleBox().value).toBe('Written before the crash')
    expect(screen.getByText(/Restored your unsaved changes from this computer/)).toBeTruthy()
    expect(status()).toBe('Unsaved changes')

    saveNow()
    await waitFor(() => expect(data.noteRows[0].title).toBe('Written before the crash'))
    expect(drafts.read(OWNER, note.id)).toBeNull()
    expect(screen.queryByText(/Restored your unsaved changes/)).toBeNull()
  })

  it('restores formatted text exactly as it was', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans', text: 'Saved text' })
    const doc = { type: 'doc' as const, content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Draft heading' }] }] }
    drafts.write({ ownerId: OWNER, noteId: note.id, isNew: false, baseRevision: 1, title: 'Plans', contextId: null, content: doc, changedAt: new Date().toISOString(), held: false })
    await open(data, `/notes/${note.id}`)
    expect(noteText().querySelector('h2')?.textContent).toBe('Draft heading')
  })

  it('lets the owner discard restored changes and go back to the saved version', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans', text: 'Saved text' })
    drafts.write({ ownerId: OWNER, noteId: note.id, isNew: false, baseRevision: 1, title: 'Unwanted', contextId: null, content: paragraphDoc('Unwanted text'), changedAt: new Date().toISOString(), held: false })
    await open(data, `/notes/${note.id}`)
    expect(titleBox().value).toBe('Unwanted')

    fireEvent.click(screen.getByRole('button', { name: 'Discard them' }))
    expect(titleBox().value).toBe('Plans')
    expect(noteText().textContent).toContain('Saved text')
    expect(drafts.read(OWNER, note.id)).toBeNull()
    expect(status()).not.toBe('Unsaved changes')
  })

  it('recovers a new note that never reached the database, and saves it only once', async () => {
    const data = new FakeData()
    data.failWrites = offline()
    const first = await open(data, '/notes/new')
    fireEvent.change(titleBox(), { target: { value: 'Unsent idea' } })
    saveNow()
    await waitFor(() => expect(status()).toMatch(/^Offline: kept/))
    first.unmount()

    data.failWrites = null
    const { router } = renderApp('/notes', signedInOwner(), data)
    const unsaved = await screen.findByRole('region', { name: 'Notes not saved yet' })
    expect(within(unsaved).getByText('Unsent idea')).toBeTruthy()
    expect(within(unsaved).getByText(/Only on this computer/)).toBeTruthy()

    fireEvent.click(within(unsaved).getByText('Unsent idea'))
    await screen.findByLabelText('Note text')
    expect(titleBox().value).toBe('Unsent idea')
    saveNow()
    await waitFor(() => expect(data.noteRows).toHaveLength(1))
    const [saved] = data.noteRows
    expect(saved.title).toBe('Unsent idea')
    await waitFor(() => expect(router.state.location.pathname).toBe(`/notes/${saved.id}`))
    expect(drafts.list(OWNER)).toEqual([])
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Notes not saved yet' })).toBeNull())
  })
})

describe('older copies never overwrite newer versions', () => {
  it('opens a copy made on an older version as two versions to choose from, never applying it', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans', text: 'Original' })
    drafts.write({ ownerId: OWNER, noteId: note.id, isNew: false, baseRevision: 1, title: 'Old local edit', contextId: null, content: paragraphDoc('Local words'), changedAt: new Date().toISOString(), held: false })
    // Meanwhile another device saved a newer version.
    await data.notes.save(note.id, { title: 'Newer, from the PC' }, 1)

    renderApp(`/notes/${note.id}`, signedInOwner(), data)
    const resolver = await screen.findByRole('region', { name: 'Resolve two versions' })
    expect(within(within(resolver).getByRole('article', { name: 'Your version' })).getByText('Old local edit')).toBeTruthy()
    expect(within(resolver).getByRole('article', { name: 'Latest version' }).textContent).toContain('Newer, from the PC')
    expect(drafts.read(OWNER, note.id)).toBeNull()
    expect(drafts.readHeld(OWNER, note.id).map((held) => held.title)).toEqual(['Old local edit'])
    expect(await screen.findByText('Two versions to resolve')).toBeTruthy()
    expect(data.noteRows[0].title).toBe('Newer, from the PC')
  })

  it('treats a copy for a note since archived the same way, without offering to overwrite it', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    drafts.write({ ownerId: OWNER, noteId: note.id, isNew: false, baseRevision: 1, title: 'Local edit', contextId: null, content: paragraphDoc('x'), changedAt: new Date().toISOString(), held: false })
    await data.notes.setArchived(note.id, true)
    renderApp(`/notes/${note.id}`, signedInOwner(), data)
    const resolver = await screen.findByRole('region', { name: 'Resolve two versions' })
    expect(within(resolver).getByText(/ · Archived/)).toBeTruthy()
    expect((within(resolver).getByRole('button', { name: 'Use my version' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('privacy of local copies', () => {
  it('ignores copies belonging to another account, and damaged ones', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    drafts.write({ ownerId: 'someone-else', noteId: note.id, isNew: false, baseRevision: 1, title: 'Not yours', contextId: null, content: paragraphDoc('x'), changedAt: new Date().toISOString(), held: false })
    localStorage.setItem(`nexus.noteDraft.v1:${OWNER}:${note.id}`, '{damaged')
    await open(data, `/notes/${note.id}`)
    expect(titleBox().value).toBe('Plans')
    expect(screen.queryByText(/Restored your unsaved changes/)).toBeNull()
    expect(screen.queryByText('Unsaved changes on this computer')).toBeNull()
  })
})

describe('signing out', () => {
  it('saves the open note first and signs out without asking when everything reached the database', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    const service = signedInOwner()
    renderApp(`/notes/${note.id}`, service, data)
    await screen.findByLabelText('Note text')
    fireEvent.change(titleBox(), { target: { value: 'Saved at sign-out' } })

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(data.noteRows[0].title).toBe('Saved at sign-out')
    expect(service.signOutCalls).toBe(1)
    expect(drafts.list(OWNER)).toEqual([])
  })

  it('asks what to do with changes that could not be saved: cancel keeps you signed in', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    data.failWrites = offline()
    const service = signedInOwner()
    renderApp(`/notes/${note.id}`, service, data)
    await screen.findByLabelText('Note text')
    fireEvent.change(titleBox(), { target: { value: 'Offline edit' } })

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('1 note has changes not yet saved to Nexus')).toBeTruthy()
    expect(within(dialog).getByText('Offline edit')).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep them on this computer and sign out' }))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(service.signOutCalls).toBe(0)
    expect(titleBox().value).toBe('Offline edit')
  })

  it('keeps the changes on this computer when asked, for the next sign-in', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    data.failWrites = offline()
    renderApp(`/notes/${note.id}`, signedInOwner(), data)
    await screen.findByLabelText('Note text')
    fireEvent.change(titleBox(), { target: { value: 'Offline edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep them on this computer and sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(drafts.read(OWNER, note.id)?.title).toBe('Offline edit')
  })

  it('deletes the changes when asked, and nothing writes them back while closing', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    data.failWrites = offline()
    renderApp(`/notes/${note.id}`, signedInOwner(), data)
    await screen.findByLabelText('Note text')
    fireEvent.change(titleBox(), { target: { value: 'Offline edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete them and sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(drafts.list(OWNER)).toEqual([])
    expect(data.noteRows[0].title).toBe('Plans')
  })

  it('keeps unsaved changes when the session ends without signing out', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    data.failWrites = offline()
    const service = signedInOwner()
    renderApp(`/notes/${note.id}`, service, data)
    await screen.findByLabelText('Note text')
    fireEvent.change(titleBox(), { target: { value: 'Typed as the session ended' } })

    act(() => service.endSession())
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy()
    expect(drafts.read(OWNER, note.id)?.title).toBe('Typed as the session ended')
  })
})
