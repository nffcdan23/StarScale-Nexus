import { describe, expect, it } from 'vitest'
import { FakeData, paragraphDoc } from './fakeData'

// The fake notes service must behave like the database rules the screens
// will rely on (proved for real by NOTE-10 to NOTE-13 and NOTE-19 to NOTE-20).

describe('fake notes service', () => {
  it('derives text, starts at revision 1, and needs no context', async () => {
    const data = new FakeData()
    const note = await data.notes.create({ title: 'Ideas', content: paragraphDoc('First idea') })
    expect(note).toMatchObject({ contextId: null, revision: 1, text: 'First idea', preview: 'First idea' })
  })

  it('raises the revision for edits only, not for pinning or archiving', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    expect((await data.notes.save(note.id, { title: 'Plans v2' }, 1)).revision).toBe(2)
    expect((await data.notes.setPinned(note.id, true)).revision).toBe(2)
    expect((await data.notes.setArchived(note.id, true)).revision).toBe(2)
  })

  it('refuses a save based on an older revision', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    await data.notes.save(note.id, { title: 'From the PC' }, 1)
    await expect(data.notes.save(note.id, { title: 'From the laptop' }, 1)).rejects.toMatchObject({ kind: 'conflict' })
    expect(data.noteRows[0].title).toBe('From the PC')
  })

  it('searches by word start, leaving out archived notes unless asked', async () => {
    const data = new FakeData()
    data.addNote({ title: 'Board meeting', text: 'Discuss the investor timeline' })
    data.addNote({ title: 'Old idea', text: 'An investor pitch', archivedAt: '2026-10-01T00:00:00Z' })
    expect((await data.notes.search('invest')).map((result) => result.title)).toEqual(['Board meeting'])
    expect((await data.notes.search('invest', { includeArchived: true })).map((result) => result.title).sort()).toEqual([
      'Board meeting',
      'Old idea',
    ])
  })

  it('lists pinned notes first, then the most recently edited', async () => {
    const data = new FakeData()
    const older = data.addNote({ title: 'Older' })
    data.addNote({ title: 'Newer' })
    data.addNote({ title: 'Pinned', pinned: true })
    await data.notes.save(older.id, { title: 'Older, edited' }, 1)
    expect((await data.notes.list()).map((note) => note.title)).toEqual(['Pinned', 'Older, edited', 'Newer'])
  })
})
