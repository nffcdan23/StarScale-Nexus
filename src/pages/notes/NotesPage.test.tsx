import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataError, type NoteDoc } from '../../data/types'
import { accounts, FakeAuthService } from '../../test/fakeAuth'
import { FakeData } from '../../test/fakeData'
import { renderApp, signedInOwner, signedInTv } from '../../test/renderApp'

// The Notes workspace against the in-memory fake database. The editor is the
// real TipTap editor; the database rules are proved by the security checks.

const noteText = () => screen.getByLabelText('Note text')
const titleBox = () => screen.getByLabelText('Title') as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: 'Save now' }) as HTMLButtonElement
const status = () => within(screen.getByRole('region', { name: 'Note' })).getAllByRole('status')[0].textContent

async function openNote(data: FakeData, id: string) {
  const view = renderApp(`/notes/${id}`, signedInOwner(), data)
  await screen.findByLabelText('Note text')
  return view
}

/** Makes browser storage refuse every write, as when it is full or blocked. */
function storageFull() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError')
  })
}

/** Selects all of the note's text, as Ctrl+A does. */
function selectAllText() {
  const text = noteText()
  text.focus()
  fireEvent.keyDown(text, { key: 'a', code: 'KeyA', ctrlKey: true })
}

/** All node and mark names in a document. */
function typesIn(node: { type?: string; marks?: Array<{ type: string }>; content?: unknown[] }, found = new Set<string>()) {
  if (node.type) found.add(node.type)
  for (const mark of node.marks ?? []) found.add(mark.type)
  for (const child of (node.content ?? []) as Array<typeof node>) typesIn(child, found)
  return found
}

describe('Notes list', () => {
  it('shows pinned notes first, then recent ones, with context or Uncategorised', async () => {
    const data = new FakeData()
    const work = data.addContext('StarScale')
    data.addNote({ title: 'Older', text: 'Earlier thoughts' })
    data.addNote({ title: 'Board meeting', text: 'Agenda\nSecond line', contextId: work.id })
    data.addNote({ title: '', text: 'No title yet', pinned: true })
    renderApp('/notes', signedInOwner(), data)

    const pinned = await screen.findByRole('region', { name: 'Pinned notes' })
    expect(within(pinned).getByRole('link').textContent).toContain('Untitled')
    const recent = screen.getByRole('region', { name: 'Recent notes' })
    const links = within(recent).getAllByRole('link')
    expect(links.map((link) => link.querySelector('span')?.textContent)).toEqual(['Board meeting', 'Older'])
    expect(links[0].textContent).toContain('Agenda')
    expect(links[0].textContent).not.toContain('Second line')
    expect(links[0].textContent).toContain('StarScale')
    expect(links[1].textContent).toContain('Uncategorised')
    expect(screen.getByText('Choose a note, or press New note to start one.')).toBeTruthy()
  })

  it('says so when there are no notes', async () => {
    renderApp('/notes', signedInOwner(), new FakeData())
    expect(await screen.findByText('No notes yet.')).toBeTruthy()
  })
})

describe('Creating a note', () => {
  it('writes nothing to the database until the first save, then opens the saved note', async () => {
    const data = new FakeData()
    const { router } = renderApp('/notes', signedInOwner(), data)
    fireEvent.click(await screen.findByRole('button', { name: 'New note' }))

    await screen.findByLabelText('Note text')
    expect(router.state.location.pathname).toBe('/notes/new')
    expect(data.noteRows).toHaveLength(0)
    expect(saveButton().disabled).toBe(true)
    expect(status()).toBe('New note')

    fireEvent.change(titleBox(), { target: { value: 'Ideas' } })
    expect(status()).toBe('Unsaved changes')
    fireEvent.click(saveButton())

    await waitFor(() => expect(data.noteRows).toHaveLength(1))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/notes/${data.noteRows[0].id}`))
    expect(data.noteRows[0]).toMatchObject({ title: 'Ideas', contextId: null })
    expect(await within(await screen.findByRole('region', { name: 'Recent notes' })).findByText('Ideas')).toBeTruthy()
  })

  it('saves a new note in a chosen context', async () => {
    const data = new FakeData()
    const work = data.addContext('StarScale')
    renderApp('/notes/new', signedInOwner(), data)
    await screen.findByRole('option', { name: 'StarScale' })
    fireEvent.change(screen.getByLabelText('Context'), { target: { value: work.id } })
    fireEvent.change(titleBox(), { target: { value: 'Filed' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(data.noteRows[0]?.contextId).toBe(work.id))
  })
})

describe('Editing and saving', () => {
  it('saves the title with the Save button and shows the saved state', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans', text: 'Text' })
    await openNote(data, note.id)
    expect(status()).toMatch(/^Edited /)
    expect(saveButton().disabled).toBe(true)

    fireEvent.change(titleBox(), { target: { value: 'Plans for Q4' } })
    expect(status()).toBe('Unsaved changes')
    fireEvent.click(saveButton())

    await waitFor(() => expect(status()).toMatch(/^Saved /))
    expect(data.noteRows[0]).toMatchObject({ title: 'Plans for Q4', revision: 2 })
  })

  it('saves with Ctrl+S or Cmd+S', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    await openNote(data, note.id)
    fireEvent.change(titleBox(), { target: { value: 'Ctrl' } })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(data.noteRows[0].title).toBe('Ctrl'))
    fireEvent.change(titleBox(), { target: { value: 'Cmd' } })
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    await waitFor(() => expect(data.noteRows[0].title).toBe('Cmd'))
  })

  it('moves a note into a context and back to Uncategorised', async () => {
    const data = new FakeData()
    const work = data.addContext('StarScale')
    const note = data.addNote({ title: 'Plans' })
    await openNote(data, note.id)
    await screen.findByRole('option', { name: 'StarScale' })

    fireEvent.change(screen.getByLabelText('Context'), { target: { value: work.id } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(data.noteRows[0].contextId).toBe(work.id))

    fireEvent.change(screen.getByLabelText('Context'), { target: { value: '' } })
    await waitFor(() => expect(saveButton().disabled).toBe(false))
    fireEvent.click(saveButton())
    await waitFor(() => expect(data.noteRows[0].contextId).toBeNull())
  })

  it('keeps the changes, says they are not saved, and saves when the connection returns', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    data.failWrites = new DataError('offline', 'Could not save the note: Nexus cannot reach the database. Nothing was changed.')
    await openNote(data, note.id)
    fireEvent.change(titleBox(), { target: { value: 'Changed' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(status()).toBe('Not saved: Nexus cannot reach the database. Retrying automatically.'))
    expect(titleBox().value).toBe('Changed')
    expect(data.noteRows[0].title).toBe('Plans')

    data.failWrites = null
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(status()).toMatch(/^Saved /))
    expect(data.noteRows[0].title).toBe('Changed')
  })

  it('shows a value the database will not accept, and does not keep retrying it', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    data.failNextWrite = new DataError('invalid', 'Could not save the note: a value was not accepted.')
    await openNote(data, note.id)
    fireEvent.change(titleBox(), { target: { value: 'Changed' } })
    fireEvent.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toContain('a value was not accepted')
    expect(status()).toBe('Not saved.')
  })
})

describe('Formatting', () => {
  it.each([
    ['Heading 1', 'heading'],
    ['Heading 2', 'heading'],
    ['Heading 3', 'heading'],
    ['Bold', 'bold'],
    ['Italic', 'italic'],
    ['Inline code', 'code'],
    ['Bulleted list', 'bulletList'],
    ['Numbered list', 'orderedList'],
    ['Checklist', 'taskList'],
    ['Quote', 'blockquote'],
    ['Code block', 'codeBlock'],
    ['Divider', 'horizontalRule'],
  ])('%s from the toolbar is saved as %s', async (button, type) => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Formatting', text: 'Some text' })
    await openNote(data, note.id)

    selectAllText()
    fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(status()).toBe('Unsaved changes'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(typesIn(data.noteRows[0].content).has(type)).toBe(true))
    expect(data.noteRows[0].revision).toBe(2)
  })

  it('shows which formats apply where the cursor is', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Formatting', text: 'Some text' })
    await openNote(data, note.id)
    selectAllText()
    const bold = screen.getByRole('button', { name: 'Bold' })
    expect(bold.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(bold)
    await waitFor(() => expect(bold.getAttribute('aria-pressed')).toBe('true'))
  })

  it('offers no strikethrough or underline', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Formatting' })
    await openNote(data, note.id)
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    expect(within(toolbar).queryByRole('button', { name: /strike|underline/i })).toBeNull()
  })
})

describe('Links', () => {
  it('turns example.com into a safe https link', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Links', text: 'Our website' })
    await openNote(data, note.id)
    selectAllText()
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    fireEvent.click(saveButton())

    await waitFor(() => expect(JSON.stringify(data.noteRows[0].content)).toContain('"href":"https://example.com"'))
    const link = noteText().querySelector('a')!
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow')
  })

  it('refuses an address that is not a web or email address', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Links', text: 'Click me' })
    await openNote(data, note.id)
    selectAllText()
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Use a web address')
    expect(noteText().querySelector('a')).toBeNull()
    expect(saveButton().disabled).toBe(true)
  })

  it('never shows a stored unsafe link as a working link, nor any stored text as HTML', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: '<img src=x onerror="alert(1)">' })
    data.noteRows[0].content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
            { type: 'text', text: ' <b>not bold</b>' },
          ],
        },
      ],
    } as NoteDoc
    await openNote(data, note.id)
    expect(noteText().innerHTML).not.toContain('javascript:')
    expect(noteText().querySelector('b')).toBeNull()
    expect(noteText().textContent).toContain('<b>not bold</b>')
    expect(titleBox().value).toBe('<img src=x onerror="alert(1)">')
    expect(document.querySelector('img')).toBeNull()
  })
})

describe('Pinning and archiving', () => {
  it('pins and unpins at once, without counting as an edit', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Important', text: 'x' })
    data.addNote({ title: 'Other', text: 'y' })
    await openNote(data, note.id)

    fireEvent.click(screen.getByRole('button', { name: 'Pin note' }))
    const pinned = await screen.findByRole('region', { name: 'Pinned notes' })
    expect(within(pinned).getByText('Important')).toBeTruthy()
    expect(data.noteRows[0]).toMatchObject({ pinned: true, revision: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Unpin note' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pinned notes' })).toBeNull())
    expect(data.noteRows[0].pinned).toBe(false)
  })

  it('archives a note, shows it read-only among archived notes, and restores it', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Old plan', text: 'x' })
    const { router } = await openNote(data, note.id)

    fireEvent.click(screen.getByRole('button', { name: 'Archive note' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/notes'))
    expect(await screen.findByText('No notes yet.')).toBeTruthy()
    expect(data.noteRows[0].archivedAt).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await within(await screen.findByRole('list', { name: 'Archived notes' })).findByText('Old plan'))
    expect(await screen.findByText('This note is archived. Restore it to edit.')).toBeTruthy()
    expect(titleBox().readOnly).toBe(true)
    expect(noteText().getAttribute('contenteditable')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Save now' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Restore note' }))
    await waitFor(() => expect(noteText().getAttribute('contenteditable')).toBe('true'))
    expect(data.noteRows[0].archivedAt).toBeNull()
    expect(status()).not.toBe('Unsaved changes')
  })

  it('will not archive while there are unsaved changes', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    await openNote(data, note.id)
    fireEvent.change(titleBox(), { target: { value: 'Changed' } })
    expect((screen.getByRole('button', { name: 'Archive note' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Unsaved changes', () => {
  it('saves before leaving a note, then moves on without asking', async () => {
    const data = new FakeData()
    const first = data.addNote({ title: 'First' })
    data.addNote({ title: 'Second' })
    await openNote(data, first.id)
    fireEvent.change(titleBox(), { target: { value: 'First, edited' } })

    fireEvent.click(within(screen.getByRole('region', { name: 'Recent notes' })).getByText('Second'))
    await waitFor(() => expect(titleBox().value).toBe('Second'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(data.noteRows.find((note) => note.id === first.id)?.title).toBe('First, edited')
  })

  it('asks before leaving only when the changes can be neither saved nor kept on this computer', async () => {
    const data = new FakeData()
    const first = data.addNote({ title: 'First' })
    data.addNote({ title: 'Second' })
    data.failWrites = new DataError('offline', 'Could not save the note: Nexus cannot reach the database. Nothing was changed.')
    storageFull()
    const { router } = await openNote(data, first.id)
    fireEvent.change(titleBox(), { target: { value: 'First, edited' } })

    fireEvent.click(within(screen.getByRole('region', { name: 'Recent notes' })).getByText('Second'))
    expect((await screen.findByRole('alertdialog')).textContent).toContain('could not be saved')
    expect(router.state.location.pathname).toBe(`/notes/${first.id}`)

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(titleBox().value).toBe('First, edited')

    fireEvent.click(within(screen.getByRole('region', { name: 'Recent notes' })).getByText('Second'))
    fireEvent.click(await screen.findByRole('button', { name: 'Leave without saving' }))
    await waitFor(() => expect(titleBox().value).toBe('Second'))
    expect(data.noteRows.find((note) => note.id === first.id)?.title).toBe('First')
  })

  it('saves before leaving Notes for another page', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    const { router } = await openNote(data, note.id)
    fireEvent.change(titleBox(), { target: { value: 'Plans, edited' } })
    fireEvent.click(screen.getByRole('link', { name: 'Tasks' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'))
    expect(data.noteRows[0].title).toBe('Plans, edited')
  })

  it('lets the tab close without a warning once unsaved changes are kept on this computer', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    await openNote(data, note.id)
    fireEvent.change(titleBox(), { target: { value: 'Changed' } })
    const closing = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closing)
    expect(closing.defaultPrevented).toBe(false)
    // The copy was made at that moment.
    expect(localStorage.length).toBe(1)
  })

  it('makes the browser warn before closing when unsaved changes cannot be kept on this computer', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    storageFull()
    await openNote(data, note.id)
    expect(screen.getByText(/This browser is not keeping copies of unsaved changes/)).toBeTruthy()

    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fireEvent.change(titleBox(), { target: { value: 'Changed' } })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

describe('Revision conflicts', () => {
  it('refuses to overwrite a newer version saved elsewhere, then reloads it on request', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans', text: 'Original' })
    await openNote(data, note.id)
    fireEvent.change(titleBox(), { target: { value: 'From the laptop' } })

    // Another device saves first.
    await act(() => data.notes.save(note.id, { title: 'From the PC' }, 1))

    fireEvent.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toContain('changed on another device')
    expect(data.noteRows[0].title).toBe('From the PC')
    expect(titleBox().value).toBe('From the laptop')
    expect(saveButton().disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Reload note' }))
    await waitFor(() => expect(titleBox().value).toBe('From the PC'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(status()).not.toBe('Unsaved changes')

    fireEvent.change(titleBox(), { target: { value: 'From the laptop, again' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(data.noteRows[0]).toMatchObject({ title: 'From the laptop, again', revision: 3 }))
  })
})

describe('Who can open Notes', () => {
  it('sends the TV sign-in to the TV display', async () => {
    const { router } = renderApp('/notes', signedInTv(), new FakeData())
    await waitFor(() => expect(router.state.location.pathname).toBe('/tv'))
  })

  it('asks the owner for an authenticator code first', async () => {
    renderApp('/notes', new FakeAuthService({ account: accounts.owner, level: 'aal1' }), new FakeData())
    expect(await screen.findByRole('heading', { name: 'Enter your authenticator code' })).toBeTruthy()
  })
})

describe('Autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

  it('saves two seconds after typing stops, with no button pressed', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    await openNote(data, note.id)
    fireEvent.change(titleBox(), { target: { value: 'Plans for Q4' } })
    await wait(1_500)
    expect(data.noteRows[0].title).toBe('Plans')
    await wait(600)
    await waitFor(() => expect(data.noteRows[0].title).toBe('Plans for Q4'))
    await waitFor(() => expect(status()).toMatch(/^Saved /))
  })

  it('saves text typed in the editor too', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Formatting', text: 'Some text' })
    await openNote(data, note.id)
    selectAllText()
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    await wait(2_100)
    await waitFor(() => expect(typesIn(data.noteRows[0].content).has('bold')).toBe(true))
  })

  it('gives a new note its address on the first save without interrupting typing', async () => {
    const data = new FakeData()
    const { router } = renderApp('/notes', signedInOwner(), data)
    fireEvent.click(await screen.findByRole('button', { name: 'New note' }))
    await screen.findByLabelText('Note text')
    const editorBefore = noteText()
    titleBox().focus()
    fireEvent.change(titleBox(), { target: { value: 'Ideas' } })

    await wait(2_100)
    await waitFor(() => expect(data.noteRows).toHaveLength(1))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/notes/${data.noteRows[0].id}`))
    // The same editor carries on, with the cursor where it was.
    expect(noteText()).toBe(editorBefore)
    expect(document.activeElement).toBe(titleBox())

    fireEvent.change(titleBox(), { target: { value: 'Ideas, continued' } })
    await wait(2_100)
    await waitFor(() => expect(data.noteRows[0].title).toBe('Ideas, continued'))
    expect(data.noteRows).toHaveLength(1)
  })

  it('creates a new note only once, however often a lost reply makes it retry', async () => {
    const data = new FakeData()
    renderApp('/notes/new', signedInOwner(), data)
    await screen.findByLabelText('Note text')
    // The note reaches the database but the reply is lost, as on a dropped connection.
    const create = data.notes.create
    let lostReplies = 2
    data.notes.create = async (changes, options) => {
      const note = await create(changes, options)
      if (lostReplies-- > 0) throw new DataError('offline', 'Could not create the note: Nexus cannot reach the database.')
      return note
    }
    fireEvent.change(titleBox(), { target: { value: 'Once only' } })
    await wait(2_100)
    await wait(5_000)
    await wait(15_000)
    await waitFor(() => expect(status()).toMatch(/^Saved /))
    expect(data.noteRows).toHaveLength(1)
  })

  it('keeps retrying while offline and stops once saved', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    data.failWrites = new DataError('offline', 'Could not save the note: Nexus cannot reach the database. Nothing was changed.')
    const save = vi.spyOn(data.notes, 'save')
    await openNote(data, note.id)
    fireEvent.change(titleBox(), { target: { value: 'Offline edit' } })

    await wait(2_100)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await wait(5_000)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    data.failWrites = null
    await wait(15_000)
    await waitFor(() => expect(data.noteRows[0].title).toBe('Offline edit'))
    await wait(120_000)
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('stops saving a note that was changed on another device, and never overwrites it', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    const save = vi.spyOn(data.notes, 'save')
    await openNote(data, note.id)
    await act(() => data.notes.save(note.id, { title: 'From the PC' }, 1))
    save.mockClear()

    fireEvent.change(titleBox(), { target: { value: 'From the laptop' } })
    await wait(2_100)
    expect((await screen.findByRole('alert')).textContent).toContain('changed on another device')
    expect(status()).toBe('Not saved: changed on another device. Your changes are kept on this computer.')
    await wait(120_000)
    fireEvent.change(titleBox(), { target: { value: 'From the laptop, still typing' } })
    await wait(30_000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(data.noteRows[0].title).toBe('From the PC')
  })

  it('loads a newer version from another device when nothing here is unsaved', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans', text: 'Old text' })
    await openNote(data, note.id)
    await act(() => data.notes.save(note.id, { title: 'Plans, from the PC', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New text' }] }] } }, 1))

    await wait(30_000)
    await waitFor(() => expect(titleBox().value).toBe('Plans, from the PC'))
    expect(noteText().textContent).toContain('New text')
    expect(status()).toMatch(/^Updated from another device /)

    // Editing carries on from the newer version.
    fireEvent.change(titleBox(), { target: { value: 'Plans, edited here' } })
    await wait(2_100)
    await waitFor(() => expect(data.noteRows[0]).toMatchObject({ title: 'Plans, edited here', revision: 3 }))
  })

  it('notices a note pinned or archived on another device', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    await openNote(data, note.id)
    await act(() => data.notes.setArchived(note.id, true))
    await wait(30_000)
    expect(await screen.findByText('This note is archived. Restore it to edit.')).toBeTruthy()
  })
})
