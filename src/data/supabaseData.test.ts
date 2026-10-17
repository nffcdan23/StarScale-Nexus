import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { slugFor } from './slug'
import { createSupabaseDataServices, toDataError, toSnippet } from './supabaseData'
import { fakeNoteText } from '../test/fakeData'
import type { NoteDoc } from './types'

// The real data layer, run against a stand-in for the Supabase client that
// records what was asked of it. This checks the requests and the handling of
// replies; only the Windows PC can check the real database.

type Reply = { data?: unknown; error?: { code?: string; message: string } | null }

function recordingClient(replies: Reply[]) {
  const calls: Array<{ table: string; steps: Array<[string, unknown[]]> }> = []
  const client = {
    from(table: string) {
      const call = { table, steps: [] as Array<[string, unknown[]]> }
      calls.push(call)
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'insert', 'update', 'eq', 'is', 'not', 'gte', 'order', 'limit', 'single', 'maybeSingle']) {
        builder[method] = (...args: unknown[]) => {
          call.steps.push([method, args])
          return builder
        }
      }
      builder.then = (resolve: (value: Reply) => void) => {
        const reply = replies.shift() ?? { data: null, error: null }
        resolve({ data: reply.data ?? null, error: reply.error ?? null })
      }
      return builder
    },
    rpc(name: string, ...args: unknown[]) {
      calls.push({ table: `rpc:${name}`, steps: [['rpc', args]] })
      return {
        then: (resolve: (value: Reply) => void) => {
          const reply = replies.shift() ?? { data: null, error: null }
          resolve({ data: reply.data ?? null, error: reply.error ?? null })
        },
      }
    },
  }
  return { services: createSupabaseDataServices(client as unknown as SupabaseClient), calls }
}

const stepNames = (steps: Array<[string, unknown[]]>) => steps.map(([name]) => name)

describe('slugFor', () => {
  it('makes a short internal name the database accepts', () => {
    expect(slugFor('StarScale')).toBe('starscale')
    expect(slugFor('  Café & Garden ')).toBe('cafe-garden')
    expect(slugFor('2026 Plans')).toBe('c-2026-plans')
    expect(slugFor('!!!')).toBe('context')
    expect(slugFor('Personal', 3)).toBe('personal-3')
  })

  it('never exceeds 40 characters, suffix included', () => {
    const slug = slugFor('a'.repeat(80), 12)
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-12')).toBe(true)
    expect(slug).toMatch(/^[a-z][a-z0-9-]{0,39}$/)
  })
})

describe('toDataError', () => {
  it('turns database refusals and failures into plain messages', () => {
    expect(toDataError({ code: '42501', message: 'permission denied' }, 'add the task').kind).toBe('refused')
    expect(toDataError({ code: '23514', message: 'check' }, 'add the task').kind).toBe('invalid')
    expect(toDataError({ code: '23503', message: 'fk' }, 'add the task').kind).toBe('missing')
    expect(toDataError({ code: '', message: 'TypeError: Failed to fetch' }, 'add the task').kind).toBe('offline')
  })
})

describe('contexts', () => {
  it('lists only active contexts unless asked for archived ones', async () => {
    const { services, calls } = recordingClient([{ data: [] }, { data: [] }])
    await services.contexts.list()
    await services.contexts.list({ includeArchived: true })
    expect(stepNames(calls[0].steps)).toContain('is')
    expect(stepNames(calls[1].steps)).not.toContain('is')
  })

  it('sends only the columns the owner may set, with an id made on the device', async () => {
    const row = { id: 'x', name: 'Personal', show_on_tv: false, archived_at: null, created_at: 't' }
    const { services, calls } = recordingClient([{ data: row }])
    const created = await services.contexts.create('  Personal ')

    const inserted = calls[0].steps.find(([name]) => name === 'insert')![1][0] as Record<string, unknown>
    expect(Object.keys(inserted).sort()).toEqual(['id', 'name', 'slug'])
    expect(inserted.name).toBe('Personal')
    expect(inserted.slug).toBe('personal')
    expect(created).toEqual({ id: 'x', name: 'Personal', showOnTv: false, archivedAt: null, createdAt: 't' })
  })

  it('tries the next short name when one is already taken', async () => {
    const row = { id: 'x', name: 'Personal', show_on_tv: false, archived_at: null, created_at: 't' }
    const taken = { code: '23505', message: 'duplicate key value violates unique constraint "contexts_owner_slug_unique"' }
    const { services, calls } = recordingClient([{ error: taken }, { data: row }])
    await services.contexts.create('Personal')

    const slugs = calls.map((call) => (call.steps.find(([name]) => name === 'insert')![1][0] as { slug: string }).slug)
    expect(slugs).toEqual(['personal', 'personal-2'])
  })

  it('refuses a blank name before asking the database', async () => {
    const { services, calls } = recordingClient([])
    await expect(services.contexts.create('   ')).rejects.toThrow('Give the context a name.')
    expect(calls).toHaveLength(0)
  })
})

describe('tasks', () => {
  const taskRow = {
    id: 't1',
    context_id: 'c1',
    title: 'Renew insurance',
    notes: null,
    status: 'done',
    priority: 'medium',
    hide_from_tv: false,
    due_on: null,
    due_at: null,
    completed_at: '2026-10-14T10:00:00Z',
    created_at: 'a',
    updated_at: 'b',
    archived_at: null,
  }

  it('creates a task with only its id, context and title', async () => {
    const { services, calls } = recordingClient([{ data: { ...taskRow, status: 'open', completed_at: null } }])
    await services.tasks.create({ contextId: 'c1', title: ' Renew insurance ' })
    const inserted = calls[0].steps.find(([name]) => name === 'insert')![1][0] as Record<string, unknown>
    expect(Object.keys(inserted).sort()).toEqual(['context_id', 'id', 'title'])
    expect(inserted.title).toBe('Renew insurance')
  })

  it('completes a task by changing only its status; the database records when', async () => {
    const { services, calls } = recordingClient([{ data: taskRow }])
    const task = await services.tasks.setDone('t1', true)
    const update = calls[0].steps.find(([name]) => name === 'update')![1][0]
    expect(update).toEqual({ status: 'done' })
    expect(task.completedAt).toBe('2026-10-14T10:00:00Z')
  })

  it('reports a refused change plainly', async () => {
    const { services } = recordingClient([{ error: { code: '42501', message: 'permission denied for table tasks' } }])
    await expect(services.tasks.setDone('t1', false)).rejects.toThrow('Nexus refused to reopen the task')
  })

  it('keeps archived tasks out of the open and completed lists', async () => {
    const { services, calls } = recordingClient([{ data: [] }, { data: [] }])
    await services.tasks.list('open')
    await services.tasks.list('done')
    expect(calls[0].steps).toContainEqual(['is', ['archived_at', null]])
    expect(calls[0].steps).toContainEqual(['eq', ['status', 'open']])
    expect(calls[1].steps).toContainEqual(['is', ['archived_at', null]])
    expect(calls[1].steps).toContainEqual(['eq', ['status', 'done']])
  })

  it('lists tasks completed since a moment, leaving out archived ones', async () => {
    const { services, calls } = recordingClient([{ data: [taskRow] }])
    const tasks = await services.tasks.completedSince(new Date('2026-10-11T23:00:00Z'))
    expect(calls[0].steps).toContainEqual(['eq', ['status', 'done']])
    expect(calls[0].steps).toContainEqual(['is', ['archived_at', null]])
    expect(calls[0].steps).toContainEqual(['gte', ['completed_at', '2026-10-11T23:00:00.000Z']])
    expect(stepNames(calls[0].steps)).not.toContain('limit')
    expect(tasks.map((task) => task.id)).toEqual(['t1'])
  })

  it('lists archived tasks whatever their status, newest first', async () => {
    const { services, calls } = recordingClient([{ data: [] }])
    await services.tasks.list('archived')
    expect(calls[0].steps).toContainEqual(['not', ['archived_at', 'is', null]])
    expect(stepNames(calls[0].steps)).not.toContain('eq')
    expect(calls[0].steps).toContainEqual(['order', ['archived_at', { ascending: false }]])
  })

  it('reads a date-only deadline and a timed deadline', async () => {
    const { services } = recordingClient([
      { data: [{ ...taskRow, due_on: '2026-10-17' }, { ...taskRow, id: 't2', due_at: '2026-10-17T08:00:00+00:00' }, { ...taskRow, id: 't3' }] },
    ])
    const [byDate, byTime, none] = await services.tasks.list('done')
    expect(byDate.deadline).toEqual({ kind: 'date', date: '2026-10-17' })
    expect(byTime.deadline).toEqual({ kind: 'time', at: '2026-10-17T08:00:00+00:00' })
    expect(none.deadline).toBeNull()
  })

  it('always sends both deadline columns, so only one can ever be set', async () => {
    const { services, calls } = recordingClient([{ data: taskRow }, { data: taskRow }, { data: taskRow }])
    await services.tasks.update('t1', { deadline: { kind: 'date', date: '2026-10-17' } })
    await services.tasks.update('t1', { deadline: { kind: 'time', at: '2026-10-17T08:00:00.000Z' } })
    await services.tasks.update('t1', { deadline: null })
    const updates = calls.map((call) => call.steps.find(([name]) => name === 'update')![1][0])
    expect(updates).toEqual([
      { due_on: '2026-10-17', due_at: null },
      { due_on: null, due_at: '2026-10-17T08:00:00.000Z' },
      { due_on: null, due_at: null },
    ])
  })

  it('saves edits as database columns, tidying text first', async () => {
    const { services, calls } = recordingClient([{ data: taskRow }])
    await services.tasks.update('t1', {
      title: ' Renew car insurance ',
      notes: '   ',
      priority: 'high',
      contextId: 'c2',
      hideFromTv: true,
    })
    const update = calls[0].steps.find(([name]) => name === 'update')![1][0]
    expect(update).toEqual({ title: 'Renew car insurance', notes: null, priority: 'high', context_id: 'c2', hide_from_tv: true })
    expect(calls[0].steps).toContainEqual(['eq', ['id', 't1']])
  })

  it('refuses a blank title or overlong notes before asking the database', async () => {
    const { services, calls } = recordingClient([])
    await expect(services.tasks.update('t1', { title: '  ' })).rejects.toThrow('Give the task a name.')
    await expect(services.tasks.update('t1', { notes: 'x'.repeat(10001) })).rejects.toThrow('Keep the notes to 10000 characters.')
    expect(calls).toHaveLength(0)
  })

  it('archives by setting the archive time and restores by clearing it', async () => {
    const { services, calls } = recordingClient([{ data: taskRow }, { data: taskRow }])
    await services.tasks.setArchived('t1', true)
    await services.tasks.setArchived('t1', false)
    const [archive, restore] = calls.map((call) => call.steps.find(([name]) => name === 'update')![1][0] as Record<string, unknown>)
    expect(Object.keys(archive)).toEqual(['archived_at'])
    expect(typeof archive.archived_at).toBe('string')
    expect(restore).toEqual({ archived_at: null })
  })
})

describe('TV summary', () => {
  const reply = {
    generated_at: '2026-10-16T19:42:00+00:00',
    tasks: [
      { title: 'File accounts', context: 'StarScale', priority: 'high', due_on: '2026-10-20', due_at: null },
      { title: 'Investor call', context: 'StarScale', priority: 'medium', due_on: null, due_at: '2026-10-21T09:00:00+00:00' },
      { title: 'Someday', context: 'Personal', priority: 'low', due_on: null, due_at: null },
    ],
  }

  it('calls the database summary function and reads both kinds of deadline', async () => {
    const { services, calls } = recordingClient([{ data: reply }])
    const summary = await services.summary.get()
    expect(calls.map((call) => call.table)).toEqual(['rpc:tv_summary'])
    expect(summary).toEqual({
      generatedAt: '2026-10-16T19:42:00+00:00',
      tasks: [
        { title: 'File accounts', context: 'StarScale', priority: 'high', deadline: { kind: 'date', date: '2026-10-20' } },
        { title: 'Investor call', context: 'StarScale', priority: 'medium', deadline: { kind: 'time', at: '2026-10-21T09:00:00+00:00' } },
        { title: 'Someday', context: 'Personal', priority: 'low', deadline: null },
      ],
    })
  })

  it('keeps the order the database chose', async () => {
    const { services } = recordingClient([{ data: { ...reply, tasks: [...reply.tasks].reverse() } }])
    expect((await services.summary.get()).tasks.map((task) => task.title)).toEqual(['Someday', 'Investor call', 'File accounts'])
  })

  it('accepts an empty summary', async () => {
    const { services } = recordingClient([{ data: { generated_at: reply.generated_at, tasks: [] } }])
    expect((await services.summary.get()).tasks).toEqual([])
  })

  it('carries only the four TV fields, whatever else a reply contains', async () => {
    const extra = { ...reply.tasks[0], notes: 'private', id: 't1' }
    const { services } = recordingClient([{ data: { ...reply, tasks: [extra] } }])
    expect(Object.keys((await services.summary.get()).tasks[0]).sort()).toEqual(['context', 'deadline', 'priority', 'title'])
  })

  it('refuses a reply in an unexpected form instead of guessing', async () => {
    const broken = { ...reply, tasks: [{ title: 'No context', priority: 'high' }] }
    const { services } = recordingClient([{ data: broken }, { data: null }])
    await expect(services.summary.get()).rejects.toThrow('unexpected form')
    await expect(services.summary.get()).rejects.toThrow('unexpected form')
  })

  it('reports a refusal plainly', async () => {
    const { services } = recordingClient([{ error: { code: '42501', message: 'tv_summary: caller is not allowed' } }])
    await expect(services.summary.get()).rejects.toThrow('Nexus refused to load the summary')
  })
})

describe('notes', () => {
  const doc: NoteDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quarterly review' }] }] }
  const noteRow = {
    id: 'n1',
    context_id: null,
    title: 'Plans',
    preview: 'Quarterly review',
    pinned: false,
    revision: 3,
    created_at: 'a',
    updated_at: 'b',
    archived_at: null,
    content: doc,
    content_text: 'Quarterly review',
  }

  it('lists active notes pinned first then most recently edited, without loading whole notes', async () => {
    const { services, calls } = recordingClient([{ data: [] }, { data: [] }])
    await services.notes.list()
    await services.notes.list({ archived: true })
    const columns = calls[0].steps.find(([name]) => name === 'select')![1][0] as string
    expect(columns).not.toContain('content')
    expect(calls[0].steps).toContainEqual(['is', ['archived_at', null]])
    expect(calls[0].steps.filter(([name]) => name === 'order')).toEqual([
      ['order', ['pinned', { ascending: false }]],
      ['order', ['updated_at', { ascending: false }]],
    ])
    expect(calls[1].steps).toContainEqual(['not', ['archived_at', 'is', null]])
  })

  it('creates a note with an id made on the device and no context unless one is chosen', async () => {
    const { services, calls } = recordingClient([{ data: noteRow }])
    const note = await services.notes.create({ title: 'Plans', content: doc })
    const inserted = calls[0].steps.find(([name]) => name === 'insert')![1][0] as Record<string, unknown>
    expect(Object.keys(inserted).sort()).toEqual(['content', 'id', 'title'])
    expect(note).toMatchObject({ id: 'n1', contextId: null, text: 'Quarterly review', revision: 3 })
  })

  it('uses the id it is given, so a retried first save cannot make a second note', async () => {
    const { services, calls } = recordingClient([{ data: noteRow }])
    await services.notes.create({ title: 'Plans' }, { id: 'fixed-id' })
    const inserted = calls[0].steps.find(([name]) => name === 'insert')![1][0] as Record<string, unknown>
    expect(inserted.id).toBe('fixed-id')
  })

  it('peeks at a note\'s revision and status without loading its content', async () => {
    const { services, calls } = recordingClient([
      { data: { id: 'n1', revision: 4, updated_at: 'b', pinned: true, archived_at: null } },
    ])
    expect(await services.notes.peek('n1')).toEqual({ id: 'n1', revision: 4, updatedAt: 'b', pinned: true, archivedAt: null })
    const columns = calls[0].steps.find(([name]) => name === 'select')![1][0] as string
    expect(columns).not.toContain('content')
    expect(calls[0].steps).toContainEqual(['eq', ['id', 'n1']])
  })

  it('never sends the searchable text, the owner or the revision', async () => {
    const { services, calls } = recordingClient([{ data: noteRow }])
    await services.notes.save('n1', { title: 'New', content: doc, contextId: 'c1' }, 3)
    const update = calls[0].steps.find(([name]) => name === 'update')![1][0] as Record<string, unknown>
    expect(Object.keys(update).sort()).toEqual(['content', 'context_id', 'title'])
  })

  it('saves only if the note is still at the revision it was loaded at', async () => {
    const { services, calls } = recordingClient([{ data: noteRow }])
    await services.notes.save('n1', { title: 'New' }, 3)
    expect(calls[0].steps).toContainEqual(['eq', ['id', 'n1']])
    expect(calls[0].steps).toContainEqual(['eq', ['revision', 3]])
  })

  it('reports a conflict when another device saved first, and nothing is overwritten', async () => {
    const { services } = recordingClient([{ data: null }, { data: { id: 'n1', revision: 4 } }])
    await expect(services.notes.save('n1', { title: 'New' }, 3)).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('reports a note that no longer exists', async () => {
    const { services } = recordingClient([{ data: null }, { data: null }])
    await expect(services.notes.save('n1', { title: 'New' }, 3)).rejects.toMatchObject({ kind: 'missing' })
  })

  it('refuses an overlong title or content that is not a document before asking the database', async () => {
    const { services, calls } = recordingClient([])
    await expect(services.notes.save('n1', { title: 'x'.repeat(201) }, 1)).rejects.toThrow('Keep the title to 200 characters.')
    await expect(services.notes.save('n1', { content: { type: 'paragraph' } as never }, 1)).rejects.toThrow('not in the expected form')
    expect(calls).toHaveLength(0)
  })

  it('refuses a note too long to store', async () => {
    const { services, calls } = recordingClient([])
    const huge = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(1_000_001) }] }] }
    await expect(services.notes.create({ content: huge })).rejects.toThrow('too long to save')
    expect(calls).toHaveLength(0)
  })

  it('pins and archives without sending anything else', async () => {
    const { services, calls } = recordingClient([{ data: noteRow }, { data: noteRow }, { data: noteRow }])
    await services.notes.setPinned('n1', true)
    await services.notes.setArchived('n1', true)
    await services.notes.setArchived('n1', false)
    const updates = calls.map((call) => call.steps.find(([name]) => name === 'update')![1][0] as Record<string, unknown>)
    expect(updates[0]).toEqual({ pinned: true })
    expect(Object.keys(updates[1])).toEqual(['archived_at'])
    expect(updates[2]).toEqual({ archived_at: null })
  })

  it('searches through the database function and turns snippets into plain parts', async () => {
    const { services, calls } = recordingClient([
      { data: [{ ...noteRow, snippet: 'Our \uE000quarterly\uE001 review' }] },
    ])
    const results = await services.notes.search('quarter', { contextId: 'c1' })
    expect(calls[0]).toEqual({
      table: 'rpc:search_notes',
      steps: [['rpc', [{ search_text: 'quarter', include_archived: false, context_filter: 'c1' }]]],
    })
    expect(results[0].snippet).toEqual([
      { text: 'Our ', match: false },
      { text: 'quarterly', match: true },
      { text: ' review', match: false },
    ])
  })

  it('does not ask the database about an empty search, and refuses an overlong one', async () => {
    const { services, calls } = recordingClient([])
    expect(await services.notes.search('   ')).toEqual([])
    await expect(services.notes.search('a'.repeat(201))).rejects.toThrow('Keep searches to 200 characters.')
    expect(calls).toHaveLength(0)
  })

  it('treats markers it cannot pair as ordinary text, never as formatting', () => {
    expect(toSnippet('a \uE000b')).toEqual([{ text: 'a ', match: false }, { text: 'b', match: false }])
    expect(toSnippet('<b>x</b> \uE000y\uE001')).toEqual([
      { text: '<b>x</b> ', match: false },
      { text: 'y', match: true },
    ])
  })

  it('the test imitation derives text by the same rule as the database (security check NOTE-10)', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'One ' }, { type: 'text', text: 'two' }, { type: 'hardBreak' }, { type: 'text', text: 'three' }] },
        { type: 'taskList', content: [{ type: 'taskItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call the bank' }] }] }] },
      ],
    }
    expect(fakeNoteText(document)).toBe('Plan\nOne two\nthree\nCall the bank')
  })
})

describe('projects (Phase 4b)', () => {
  const taskRow = {
    id: 't1',
    context_id: 'c1',
    project_id: null,
    title: 'Fictional task',
    notes: null,
    status: 'done',
    priority: 'medium',
    hide_from_tv: false,
    due_on: null,
    due_at: null,
    completed_at: '2026-10-14T10:00:00Z',
    created_at: 'a',
    updated_at: 'b',
    archived_at: null,
  }
  const noteRow = {
    id: 'n1',
    context_id: null,
    project_id: null,
    title: 'Fictional note',
    preview: '',
    pinned: false,
    revision: 3,
    created_at: 'a',
    updated_at: 'b',
    archived_at: null,
    content: { type: 'doc', content: [] },
    content_text: '',
  }
  const projectRow = {
    id: 'p1',
    name: 'Fictional launch',
    context_id: 'c1',
    created_at: '2026-10-17T10:00:00Z',
    updated_at: '2026-10-17T10:00:00Z',
    archived_at: null,
  }

  it('lists active projects by name, or all of them when asked', async () => {
    const { services, calls } = recordingClient([{ data: [projectRow] }, { data: [] }])
    expect(await services.projects.list()).toEqual([
      { id: 'p1', name: 'Fictional launch', contextId: 'c1', createdAt: projectRow.created_at, updatedAt: projectRow.updated_at, archivedAt: null },
    ])
    await services.projects.list({ includeArchived: true })
    expect(calls[0].table).toBe('projects')
    expect(calls[0].steps).toContainEqual(['order', ['name']])
    expect(calls[0].steps).toContainEqual(['is', ['archived_at', null]])
    expect(stepNames(calls[1].steps)).not.toContain('is')
  })

  it('creates a project with an id made on the device, its trimmed name and optional context', async () => {
    const { services, calls } = recordingClient([{ data: projectRow }])
    await services.projects.create({ name: '  Fictional launch ', contextId: 'c1' })
    const inserted = calls[0].steps.find(([name]) => name === 'insert')![1][0] as Record<string, unknown>
    expect(Object.keys(inserted).sort()).toEqual(['context_id', 'id', 'name'])
    expect(inserted.name).toBe('Fictional launch')
    await expect(services.projects.create({ name: '   ' })).rejects.toThrow('Give the project a name.')
    await expect(services.projects.create({ name: 'x'.repeat(81) })).rejects.toThrow('Keep the project to 80 characters.')
  })

  it('returns the existing project when a retried create reaches the database twice', async () => {
    const { services } = recordingClient([
      { error: { code: '23505', message: 'duplicate key value violates unique constraint "projects_pkey"' } },
      { data: projectRow },
    ])
    expect((await services.projects.create({ name: 'Fictional launch' }, { id: 'p1' })).id).toBe('p1')
  })

  it('explains a name already used by an active project, on create, rename and restore', async () => {
    const duplicate = { error: { code: '23505', message: 'duplicate key value violates unique constraint "projects_active_name_unique"' } }
    const { services } = recordingClient([duplicate, duplicate, duplicate])
    await expect(services.projects.create({ name: 'Taken' })).rejects.toThrow('already have an active project with that name')
    await expect(services.projects.rename('p1', 'Taken')).rejects.toThrow('already have an active project with that name')
    await expect(services.projects.setArchived('p1', false)).rejects.toThrow('Another active project already has this name')
  })

  it('archives and restores by changing only archived_at', async () => {
    const { services, calls } = recordingClient([{ data: projectRow }, { data: projectRow }])
    await services.projects.setArchived('p1', true)
    await services.projects.setArchived('p1', false)
    const updates = calls.map((call) => call.steps.find(([name]) => name === 'update')![1][0] as Record<string, unknown>)
    expect(Object.keys(updates[0])).toEqual(['archived_at'])
    expect(updates[1]).toEqual({ archived_at: null })
  })

  it("loads a project's active notes and unarchived tasks, open tasks first", async () => {
    const open = { ...taskRow, id: 'open', status: 'open', completed_at: null, project_id: 'p1' }
    const done = { ...taskRow, id: 'done', status: 'done', project_id: 'p1' }
    const { services, calls } = recordingClient([{ data: [{ ...noteRow, project_id: 'p1' }] }, { data: [done, open] }])
    const contents = await services.projects.contents('p1')
    expect(contents.notes.map((note) => note.projectId)).toEqual(['p1'])
    expect(contents.tasks.map((task) => task.id)).toEqual(['open', 'done'])
    for (const call of calls) {
      expect(call.steps).toContainEqual(['eq', ['project_id', 'p1']])
      expect(call.steps).toContainEqual(['is', ['archived_at', null]])
    }
  })

  it('moves a note by changing only project_id, so it is not an edit', async () => {
    const { services, calls } = recordingClient([{ data: { ...noteRow, project_id: 'p1' } }, { data: { ...noteRow, project_id: null } }])
    expect((await services.notes.setProject('n1', 'p1')).projectId).toBe('p1')
    await services.notes.setProject('n1', null)
    const updates = calls.map((call) => call.steps.find(([name]) => name === 'update')![1][0])
    expect(updates).toEqual([{ project_id: 'p1' }, { project_id: null }])
    for (const call of calls) expect(stepNames(call.steps)).not.toContain('maybeSingle')
  })

  it('lists the Inbox, one project, or every note', async () => {
    const { services, calls } = recordingClient([{ data: [] }, { data: [] }, { data: [] }])
    await services.notes.list({ projectId: null })
    await services.notes.list({ projectId: 'p1' })
    await services.notes.list()
    expect(calls[0].steps).toContainEqual(['is', ['project_id', null]])
    expect(calls[1].steps).toContainEqual(['eq', ['project_id', 'p1']])
    expect(calls[2].steps.some(([, args]) => args[0] === 'project_id')).toBe(false)
  })

  it('creates a note directly in a project', async () => {
    const { services, calls } = recordingClient([{ data: { ...noteRow, project_id: 'p1' } }])
    await services.notes.create({ title: 'In the project' }, { id: 'n9', projectId: 'p1' })
    const inserted = calls[0].steps.find(([name]) => name === 'insert')![1][0] as Record<string, unknown>
    expect(inserted).toMatchObject({ id: 'n9', project_id: 'p1' })
  })

  it('puts a task in a project, or takes it out', async () => {
    const { services, calls } = recordingClient([{ data: taskRow }, { data: taskRow }, { data: taskRow }])
    await services.tasks.setProject('t1', 'p1')
    await services.tasks.update('t1', { projectId: null })
    await services.tasks.create({ contextId: 'c1', title: 'In the project', projectId: 'p1' })
    expect(calls[0].steps.find(([name]) => name === 'update')![1][0]).toEqual({ project_id: 'p1' })
    expect(calls[1].steps.find(([name]) => name === 'update')![1][0]).toEqual({ project_id: null })
    expect(calls[2].steps.find(([name]) => name === 'insert')![1][0]).toMatchObject({ project_id: 'p1' })
  })

  it('searches one project, the Inbox or pinned notes, sending only the filters used', async () => {
    const { services, calls } = recordingClient([{ data: [] }, { data: [] }, { data: [] }])
    await services.notes.search('plan', { projectId: 'p1' })
    await services.notes.search('plan', { projectId: null })
    await services.notes.search('plan', { pinnedOnly: true })
    expect(calls.map((call) => call.steps[0][1][0])).toEqual([
      { search_text: 'plan', include_archived: false, context_filter: null, project_filter: 'p1' },
      { search_text: 'plan', include_archived: false, context_filter: null, inbox_only: true },
      { search_text: 'plan', include_archived: false, context_filter: null, pinned_only: true },
    ])
  })

  it('says when a project, not a context, no longer exists', () => {
    const projectGone = toDataError(
      { code: '23503', message: 'insert or update on table "notes" violates foreign key constraint "notes_project_same_owner"' },
      'move the note',
    )
    expect(projectGone.message).toBe('Could not move the note: its project no longer exists.')
    const contextGone = toDataError(
      { code: '23503', message: 'insert or update on table "projects" violates foreign key constraint "projects_context_same_owner"' },
      'create the project',
    )
    expect(contextGone.message).toBe('Could not create the project: its context no longer exists.')
  })
})
