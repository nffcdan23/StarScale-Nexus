import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { slugFor } from './slug'
import { createSupabaseDataServices, toDataError } from './supabaseData'

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
      for (const method of ['select', 'insert', 'update', 'eq', 'is', 'not', 'order', 'limit', 'single']) {
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
