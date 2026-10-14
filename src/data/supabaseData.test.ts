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
      for (const method of ['select', 'insert', 'update', 'eq', 'is', 'order', 'limit', 'single']) {
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

  it('never lists archived tasks', async () => {
    const { services, calls } = recordingClient([{ data: [] }])
    await services.tasks.list('open')
    expect(calls[0].steps).toContainEqual(['is', ['archived_at', null]])
    expect(calls[0].steps).toContainEqual(['eq', ['status', 'open']])
  })
})
