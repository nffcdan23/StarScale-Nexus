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

  it('creates a note once for a given id, however often the request is repeated', async () => {
    const data = new FakeData()
    const first = await data.notes.create({ title: 'Once' }, { id: 'stable-id' })
    const again = await data.notes.create({ title: 'Once' }, { id: 'stable-id' })
    expect(first.id).toBe('stable-id')
    expect(again.id).toBe('stable-id')
    expect(data.noteRows).toHaveLength(1)
  })

  it('peeks at revision and status', async () => {
    const data = new FakeData()
    const note = data.addNote({ title: 'Plans' })
    await data.notes.save(note.id, { title: 'Plans v2' }, 1)
    await data.notes.setPinned(note.id, true)
    expect(await data.notes.peek(note.id)).toMatchObject({ revision: 2, pinned: true, archivedAt: null })
  })
})

describe('fake projects (Phase 4b)', () => {
  it('keeps active project names unique, ignoring case and spaces, and frees archived names', async () => {
    const data = new FakeData()
    const launch = await data.projects.create({ name: 'Fictional launch' })
    await expect(data.projects.create({ name: ' fictional LAUNCH ' })).rejects.toThrow('already have an active project')
    await data.projects.setArchived(launch.id, true)
    const again = await data.projects.create({ name: 'Fictional launch' })
    await expect(data.projects.setArchived(launch.id, false)).rejects.toThrow('Another active project already has this name')
    await data.projects.rename(again.id, 'Fictional launch two')
    expect((await data.projects.setArchived(launch.id, false)).archivedAt).toBeNull()
    expect((await data.projects.list()).map((project) => project.name)).toEqual(['Fictional launch', 'Fictional launch two'])
  })

  it('moves a note without counting it as an edit, and lists the Inbox and each project', async () => {
    const data = new FakeData()
    const project = await data.projects.create({ name: 'Fictional launch' })
    const note = data.addNote({ title: 'Fictional note', text: 'Plan the launch' })
    const moved = await data.notes.setProject(note.id, project.id)
    expect(moved).toMatchObject({ projectId: project.id, revision: note.revision, updatedAt: note.updatedAt })
    data.addNote({ title: 'Inbox note' })
    expect((await data.notes.list({ projectId: null })).map((entry) => entry.title)).toEqual(['Inbox note'])
    expect((await data.notes.list({ projectId: project.id })).map((entry) => entry.title)).toEqual(['Fictional note'])
    expect(await data.notes.list()).toHaveLength(2)
    expect((await data.notes.search('launch', { projectId: project.id })).map((entry) => entry.projectId)).toEqual([project.id])
    expect(await data.notes.search('launch', { projectId: null })).toEqual([])
  })

  it("shows a project's notes and tasks, which stay linked when it is archived", async () => {
    const data = new FakeData()
    const context = data.addContext('Fictional work')
    const project = await data.projects.create({ name: 'Fictional launch', contextId: context.id })
    const task = await data.tasks.create({ contextId: context.id, title: 'Fictional task', projectId: project.id })
    const note = await data.notes.create({ title: 'Fictional note' }, { projectId: project.id })
    await data.projects.setArchived(project.id, true)
    const contents = await data.projects.contents(project.id)
    expect(contents.tasks.map((entry) => entry.id)).toEqual([task.id])
    expect(contents.notes.map((entry) => entry.id)).toEqual([note.id])
    await data.tasks.setProject(task.id, null)
    expect((await data.projects.contents(project.id)).tasks).toEqual([])
    await expect(data.notes.setProject(note.id, 'no-such-project')).rejects.toThrow('project no longer exists')
  })
})
