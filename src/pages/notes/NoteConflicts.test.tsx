import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataError, type NoteDoc } from '../../data/types'
import { drafts } from '../../features/notes/drafts'
import { accounts } from '../../test/fakeAuth'
import { FakeData, paragraphDoc } from '../../test/fakeData'
import { renderApp, signedInOwner } from '../../test/renderApp'

// Phase 3c-3: settling two versions of one note, against the fake database
// and the browser's real local storage (jsdom).

const OWNER = `fake-${accounts.owner.email}`
const offline = () => new DataError('offline', 'Could not save the note: Nexus cannot reach the database. Nothing was changed.')

/** Formatted text, to check formatting survives every choice. */
const richDoc: NoteDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'My heading' }] },
    { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Bold words' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Point' }] }] }] },
  ],
}

const resolver = () => screen.getByRole('region', { name: 'Resolve two versions' })
const titleBox = () => screen.getByLabelText('Title') as HTMLInputElement
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

/** Waits until a choice can be made (the latest version has loaded), then makes it. */
async function choose(name: string) {
  await waitFor(() => expect(button(name).disabled).toBe(false))
  fireEvent.click(button(name))
}

/**
 * A note with your unsaved version on this computer (made on revision 1)
 * while another device has saved revision 2: opening it shows both.
 */
function conflictOnOpen(options: { mine?: Partial<Parameters<typeof drafts.write>[0]>; archive?: boolean } = {}) {
  const data = new FakeData()
  const work = data.addContext('StarScale')
  const note = data.addNote({ title: 'Plans', text: 'Original' })
  drafts.write({
    ownerId: OWNER,
    noteId: note.id,
    isNew: false,
    baseRevision: 1,
    title: 'Plans, my version',
    contextId: work.id,
    content: richDoc,
    changedAt: '2026-10-15T13:41:00.000Z',
    held: false,
    ...options.mine,
  })
  void data.notes.save(note.id, { title: 'Plans, from the PC', content: paragraphDoc('Newer text') }, 1)
  if (options.archive) void data.notes.setArchived(note.id, true)
  return { data, note, work }
}

async function openConflict(data: FakeData, noteId: string) {
  const view = renderApp(`/notes/${noteId}`, signedInOwner(), data)
  await screen.findByRole('region', { name: 'Resolve two versions' })
  await waitFor(() => expect(button('Keep both (recommended)').disabled).toBe(false))
  return view
}

describe('the conflict screen', () => {
  it('shows both versions in full, with formatting, times and contexts, and pauses editing', async () => {
    const { data, note } = conflictOnOpen()
    await openConflict(data, note.id)

    const mine = within(resolver()).getByRole('article', { name: 'Your version' })
    expect(within(mine).getByText('Plans, my version')).toBeTruthy()
    expect(within(mine).getByText(/Changed on this computer/)).toBeTruthy()
    expect(within(mine).getByText(/StarScale/)).toBeTruthy()
    expect(within(mine).getByLabelText("Your version's text").querySelector('h2')?.textContent).toBe('My heading')
    expect(within(mine).getByLabelText("Your version's text").querySelector('strong')?.textContent).toBe('Bold words')

    const latest = within(resolver()).getByRole('article', { name: 'Latest version' })
    expect(within(latest).getByText('Plans, from the PC')).toBeTruthy()
    expect(within(latest).getByText(/Saved in Nexus/)).toBeTruthy()
    expect(within(latest).getByText(/Uncategorised/)).toBeTruthy()
    expect(within(latest).getByText('Newer text')).toBeTruthy()

    expect(screen.getAllByRole('status')[0].textContent).toBe('Not saved: two versions to choose from. Yours is kept on this computer.')
    expect(screen.queryByRole('button', { name: 'Save now' })).toBeNull()
    expect(screen.getByText(/“Plans, my version \(my version, 15 Oct, 2:41 PM\)”/)).toBeTruthy()
  })

  it('needs no decision when your version already matches the database', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans', text: 'Same' })
    drafts.write({ ownerId: OWNER, noteId: note.id, isNew: false, baseRevision: 0, title: 'Plans', contextId: null, content: paragraphDoc('Same'), changedAt: new Date().toISOString(), held: false })
    renderApp(`/notes/${note.id}`, signedInOwner(), data)
    await screen.findByLabelText('Note text')
    expect(screen.queryByRole('region', { name: 'Resolve two versions' })).toBeNull()
    expect(drafts.list(OWNER)).toEqual([])
  })
})

describe('Keep both', () => {
  it('saves your version as a clearly named new note with its formatting and context, and keeps the latest', async () => {
    const { data, note, work } = conflictOnOpen()
    await openConflict(data, note.id)
    const [held] = drafts.readHeld(OWNER, note.id)

    fireEvent.click(button('Keep both (recommended)'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Resolve two versions' })).toBeNull())

    const copy = data.noteRows.find((entry) => entry.id === held.heldId)!
    expect(copy.title).toBe('Plans, my version (my version, 15 Oct, 2:41 PM)')
    expect(copy.content).toEqual(richDoc)
    expect(copy.contextId).toBe(work.id)
    expect(data.noteRows.find((entry) => entry.id === note.id)).toMatchObject({ title: 'Plans, from the PC', revision: 2 })
    expect(drafts.list(OWNER)).toEqual([])

    expect(titleBox().value).toBe('Plans, from the PC')
    expect(titleBox().readOnly).toBe(false)
    expect(screen.getByRole('link', { name: 'Open your version' }).getAttribute('href')).toBe(`/notes/${copy.id}`)
  })

  it('keeps everything when the copy cannot be saved, and makes only one copy when tried again', async () => {
    const { data, note } = conflictOnOpen()
    await openConflict(data, note.id)
    data.failWrites = offline()
    fireEvent.click(button('Keep both (recommended)'))
    expect((await within(resolver()).findByRole('alert')).textContent).toContain('Your version is still kept; nothing was lost.')
    expect(drafts.readHeld(OWNER, note.id)).toHaveLength(1)

    data.failWrites = null
    await choose('Keep both (recommended)')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Resolve two versions' })).toBeNull())
    expect(data.noteRows).toHaveLength(2)
  })

  it('never makes a second copy, even if the browser closed after the copy was saved but before it was confirmed', async () => {
    const { data, note } = conflictOnOpen()
    const create = data.notes.create
    let replyLost = true
    data.notes.create = async (changes, options) => {
      const made = await create(changes, options)
      if (replyLost) {
        replyLost = false
        throw offline()
      }
      return made
    }
    const first = await openConflict(data, note.id)
    fireEvent.click(button('Keep both (recommended)'))
    await within(resolver()).findByRole('alert')
    expect(data.noteRows).toHaveLength(2)
    first.unmount() // the browser closes

    await openConflict(data, note.id)
    fireEvent.click(button('Keep both (recommended)'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Resolve two versions' })).toBeNull())
    expect(data.noteRows).toHaveLength(2)
    expect(drafts.list(OWNER)).toEqual([])
  })
})

describe('Use latest version', () => {
  it('asks first, then discards your version and shows the latest', async () => {
    const { data, note } = conflictOnOpen()
    await openConflict(data, note.id)

    fireEvent.click(button('Use latest version'))
    expect(within(resolver()).getByRole('alertdialog', { name: 'Confirm using the latest version' }).textContent).toContain(
      'cannot be recovered',
    )
    fireEvent.click(button('Back'))
    expect(drafts.readHeld(OWNER, note.id)).toHaveLength(1)

    await choose('Use latest version')
    fireEvent.click(button('Discard my changes'))
    await waitFor(() => expect(titleBox().value).toBe('Plans, from the PC'))
    expect(drafts.list(OWNER)).toEqual([])
    expect(data.noteRows).toHaveLength(1)
    expect(data.noteRows[0]).toMatchObject({ title: 'Plans, from the PC', revision: 2 })
  })
})

describe('Use my version', () => {
  it('asks first, then replaces the latest version with yours, formatting and context included', async () => {
    const { data, note, work } = conflictOnOpen()
    await openConflict(data, note.id)

    fireEvent.click(button('Use my version'))
    expect(within(resolver()).getByRole('alertdialog', { name: 'Confirm using my version' }).textContent).toContain(
      'Nexus keeps no older versions',
    )
    fireEvent.click(button('Replace with my version'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Resolve two versions' })).toBeNull())

    expect(data.noteRows[0]).toMatchObject({ title: 'Plans, my version', contextId: work.id, revision: 3 })
    expect(data.noteRows[0].content).toEqual(richDoc)
    expect(drafts.list(OWNER)).toEqual([])
    expect(titleBox().value).toBe('Plans, my version')
  })

  it('stops when the note changed again while deciding, shows the newer version, and overwrites nothing', async () => {
    const { data, note } = conflictOnOpen()
    await openConflict(data, note.id)
    await act(() => data.notes.save(note.id, { title: 'Plans, changed again' }, 2))

    fireEvent.click(button('Use my version'))
    fireEvent.click(button('Replace with my version'))
    expect(await screen.findByText(/changed again on another device while you were deciding/)).toBeTruthy()
    expect(within(resolver()).getByRole('article', { name: 'Latest version' }).textContent).toContain('Plans, changed again')
    expect(data.noteRows[0]).toMatchObject({ title: 'Plans, changed again', revision: 3 })
    expect(drafts.readHeld(OWNER, note.id)).toHaveLength(1)

    // Choosing again now works against the newest version.
    await choose('Use my version')
    fireEvent.click(button('Replace with my version'))
    await waitFor(() => expect(data.noteRows[0]).toMatchObject({ title: 'Plans, my version', revision: 4 }))
  })

  it('also stops if the note changes between the check and the save', async () => {
    const { data, note } = conflictOnOpen()
    await openConflict(data, note.id)
    const save = data.notes.save
    let raced = false
    data.notes.save = async (id, changes, base) => {
      if (!raced) {
        raced = true
        await save(id, { title: 'Slipped in' }, 2)
      }
      return save(id, changes, base)
    }
    fireEvent.click(button('Use my version'))
    fireEvent.click(button('Replace with my version'))
    expect(await screen.findByText(/changed again on another device/)).toBeTruthy()
    expect(data.noteRows[0].title).toBe('Slipped in')
  })

  it('keeps your version when the replacement cannot be saved', async () => {
    const { data, note } = conflictOnOpen()
    await openConflict(data, note.id)
    data.failWrites = offline()
    fireEvent.click(button('Use my version'))
    fireEvent.click(button('Replace with my version'))
    expect((await within(resolver()).findByRole('alert')).textContent).toContain('nothing was lost')
    expect(data.noteRows[0].title).toBe('Plans, from the PC')
    expect(drafts.readHeld(OWNER, note.id)).toHaveLength(1)
  })
})

describe('archived notes', () => {
  it('never changes or restores an archived note, and keeps your version as a new active note', async () => {
    const { data, note } = conflictOnOpen({ archive: true })
    await openConflict(data, note.id)
    expect(button('Use my version').disabled).toBe(true)
    expect(within(resolver()).getByText(/an archived note is never changed or restored automatically/)).toBeTruthy()

    fireEvent.click(button('Keep both (recommended)'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Resolve two versions' })).toBeNull())
    const original = data.noteRows.find((entry) => entry.id === note.id)!
    expect(original.archivedAt).not.toBeNull()
    expect(original.title).toBe('Plans, from the PC')
    const copy = data.noteRows.find((entry) => entry.id !== note.id)!
    expect(copy.archivedAt).toBeNull()
    expect(screen.getByText('This note is archived. Restore it to edit.')).toBeTruthy()
  })
})

describe('conflicts found while editing', () => {
  it('stops saving, keeps your version, and resolves it after a browser restart', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    const first = renderApp(`/notes/${note.id}`, signedInOwner(), data)
    await screen.findByLabelText('Note text')
    await act(() => data.notes.save(note.id, { title: 'From the PC' }, 1))
    fireEvent.change(titleBox(), { target: { value: 'From the laptop' } })
    fireEvent.click(button('Save now'))

    await screen.findByRole('region', { name: 'Resolve two versions' })
    expect(drafts.readHeld(OWNER, note.id).map((held) => held.title)).toEqual(['From the laptop'])
    expect(drafts.read(OWNER, note.id)).toBeNull()
    first.unmount() // the browser closes with the conflict unresolved

    await openConflict(data, note.id)
    expect(within(resolver()).getByRole('article', { name: 'Your version' }).textContent).toContain('From the laptop')
    fireEvent.click(button('Keep both (recommended)'))
    await waitFor(() => expect(data.noteRows).toHaveLength(2))
    const titles = data.noteRows.map((entry) => entry.title)
    expect(titles).toContain('From the PC')
    expect(titles.some((title) => title.startsWith('From the laptop (my version, '))).toBe(true)
  })

  it('handles the same note edited in two tabs: a tab never deletes a copy it did not write, and the database keeps both', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    renderApp(`/notes/${note.id}`, signedInOwner(), data)
    renderApp(`/notes/${note.id}`, signedInOwner(), data)
    await waitFor(() => expect(screen.getAllByLabelText('Title')).toHaveLength(2))
    const [tabA, tabB] = screen.getAllByLabelText('Title') as HTMLInputElement[]

    fireEvent.change(tabA, { target: { value: 'Typed in tab A' } })
    await waitFor(() => expect(drafts.read(OWNER, note.id)?.title).toBe('Typed in tab A'))
    // Tab B typed most recently, so this computer's copy is tab B's.
    fireEvent.change(tabB, { target: { value: 'Typed in tab B' } })
    await waitFor(() => expect(drafts.read(OWNER, note.id)?.title).toBe('Typed in tab B'))

    // Tab A saves: its confirmed save must not delete tab B's copy.
    fireEvent.click(screen.getAllByRole('button', { name: 'Save now' })[0])
    await waitFor(() => expect(data.noteRows[0].title).toBe('Typed in tab A'))
    expect(drafts.read(OWNER, note.id)?.title).toBe('Typed in tab B')

    // Tab B's save then shows both versions instead of overwriting tab A's.
    fireEvent.click(screen.getAllByRole('button', { name: 'Save now' })[1])
    await screen.findByRole('region', { name: 'Resolve two versions' })
    expect(drafts.readHeld(OWNER, note.id).map((held) => held.title)).toEqual(['Typed in tab B'])
    expect(data.noteRows[0].title).toBe('Typed in tab A')
  })

  it('works through several waiting versions one at a time', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    await data.notes.save(note.id, { title: 'Plans v2' }, 1)
    for (const [heldId, changedAt] of [['one', '2026-10-15T10:00:00.000Z'], ['two', '2026-10-15T11:00:00.000Z']]) {
      drafts.write({ ownerId: OWNER, noteId: note.id, isNew: false, baseRevision: 1, title: `Version ${heldId}`, contextId: null, content: paragraphDoc(heldId), changedAt, held: true, heldId })
    }
    await openConflict(data, note.id)
    expect(within(resolver()).getByText(/one more version from this computer/)).toBeTruthy()
    expect(within(resolver()).getByRole('article', { name: 'Your version' }).textContent).toContain('Version one')

    fireEvent.click(button('Keep both (recommended)'))
    await waitFor(() => expect(within(resolver()).getByRole('article', { name: 'Your version' }).textContent).toContain('Version two'))
    await choose('Keep both (recommended)')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Resolve two versions' })).toBeNull())
    expect(data.noteRows).toHaveLength(3)
    expect(drafts.list(OWNER)).toEqual([])
  })
})

describe('sessions and accounts', () => {
  it('keeps your version when the session expires during a decision', async () => {
    const { data, note } = conflictOnOpen()
    const service = signedInOwner()
    renderApp(`/notes/${note.id}`, service, data)
    await screen.findByRole('region', { name: 'Resolve two versions' })
    await waitFor(() => expect(button('Keep both (recommended)').disabled).toBe(false))
    service.expireQuietly()
    data.failWrites = new DataError('refused', 'Nexus refused to create the note. Your sign-in may have ended; sign in again and retry.')

    fireEvent.click(button('Keep both (recommended)'))
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy()
    expect(drafts.readHeld(OWNER, note.id)).toHaveLength(1)
    expect(data.noteRows).toHaveLength(1)
  })

  it('never shows another account\'s versions', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    await data.notes.save(note.id, { title: 'Plans v2' }, 1)
    drafts.write({ ownerId: 'someone-else', noteId: note.id, isNew: false, baseRevision: 1, title: 'Not yours', contextId: null, content: paragraphDoc('x'), changedAt: new Date().toISOString(), held: true, heldId: 'theirs' })
    renderApp(`/notes/${note.id}`, signedInOwner(), data)
    await screen.findByLabelText('Note text')
    expect(screen.queryByRole('region', { name: 'Resolve two versions' })).toBeNull()
    expect(drafts.readHeld('someone-else', note.id)).toHaveLength(1)
  })
})
