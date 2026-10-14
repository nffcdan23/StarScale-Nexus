import type { SupabaseClient } from '@supabase/supabase-js'
import { slugFor } from './slug'
import {
  DataError,
  type Context,
  type ContextsService,
  type DataServices,
  type Task,
  type TaskStatus,
  type TasksService,
} from './types'

// The only code that reads or writes contexts and tasks. Every request runs
// with the signed-in owner's own session; the database decides what is
// allowed.

const contextColumns = 'id, name, show_on_tv, archived_at, created_at'
const taskColumns =
  'id, context_id, title, notes, status, priority, hide_from_tv, completed_at, created_at, updated_at, archived_at'

interface ContextRow {
  id: string
  name: string
  show_on_tv: boolean
  archived_at: string | null
  created_at: string
}

interface TaskRow {
  id: string
  context_id: string
  title: string
  notes: string | null
  status: Task['status']
  priority: Task['priority']
  hide_from_tv: boolean
  completed_at: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

const toContext = (row: ContextRow): Context => ({
  id: row.id,
  name: row.name,
  showOnTv: row.show_on_tv,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
})

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  contextId: row.context_id,
  title: row.title,
  notes: row.notes,
  status: row.status,
  priority: row.priority,
  hideFromTv: row.hide_from_tv,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
})

interface PostgrestErrorLike {
  code?: string
  message: string
}

/** Turns a database or network failure into a message the owner can act on. */
export function toDataError(error: PostgrestErrorLike | null | undefined, action: string): DataError {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303') {
    return new DataError('refused', `Nexus refused to ${action}. Your sign-in may have ended; sign in again and retry.`)
  }
  if (code === '23514' || code === '22001') return new DataError('invalid', `Could not ${action}: a value was not accepted.`)
  if (code === '23503') return new DataError('missing', `Could not ${action}: its context no longer exists.`)
  if (code === 'PGRST116') return new DataError('missing', `Could not ${action}: it no longer exists.`)
  if (/fetch|network|failed to fetch/i.test(message) || code === '') {
    return new DataError('offline', `Could not ${action}: Nexus cannot reach the database. Nothing was changed.`)
  }
  return new DataError('unknown', `Could not ${action}. (${message})`)
}

const isDuplicate = (error: PostgrestErrorLike | null, constraint: string) =>
  error?.code === '23505' && error.message.includes(constraint)

const trimmed = (value: string, what: string, max: number) => {
  const text = value.trim()
  if (!text) throw new DataError('invalid', `Give the ${what} a name.`)
  if (text.length > max) throw new DataError('invalid', `Keep the ${what} to ${max} characters.`)
  return text
}

function contextsService(client: SupabaseClient): ContextsService {
  const update = async (id: string, changes: Record<string, unknown>, action: string) => {
    const { data, error } = await client.from('contexts').update(changes).eq('id', id).select(contextColumns).single()
    if (error) throw toDataError(error, action)
    return toContext(data as ContextRow)
  }

  return {
    async list({ includeArchived = false } = {}) {
      let query = client.from('contexts').select(contextColumns).order('created_at')
      if (!includeArchived) query = query.is('archived_at', null)
      const { data, error } = await query
      if (error) throw toDataError(error, 'load your contexts')
      return (data as ContextRow[]).map(toContext)
    },

    async create(rawName) {
      const name = trimmed(rawName, 'context', 60)
      // The id is made here, so a retried request can never create a second copy.
      const id = crypto.randomUUID()
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        const { data, error } = await client
          .from('contexts')
          .insert({ id, name, slug: slugFor(name, attempt) })
          .select(contextColumns)
          .single()
        if (!error) return toContext(data as ContextRow)
        if (isDuplicate(error, 'contexts_owner_slug_unique')) continue
        if (isDuplicate(error, 'contexts_pkey')) {
          const existing = await client.from('contexts').select(contextColumns).eq('id', id).single()
          if (!existing.error) return toContext(existing.data as ContextRow)
        }
        throw toDataError(error, 'create the context')
      }
      throw new DataError('invalid', 'Too many contexts have a similar name. Choose a different name.')
    },

    rename: (id, rawName) => update(id, { name: trimmed(rawName, 'context', 60) }, 'rename the context'),
    setShowOnTv: (id, showOnTv) => update(id, { show_on_tv: showOnTv }, 'change the TV setting'),
    setArchived: (id, archived) =>
      update(id, { archived_at: archived ? new Date().toISOString() : null }, archived ? 'archive the context' : 'restore the context'),
  }
}

function tasksService(client: SupabaseClient): TasksService {
  return {
    async list(status: TaskStatus) {
      let query = client.from('tasks').select(taskColumns).eq('status', status).is('archived_at', null)
      query =
        status === 'done'
          ? query.order('completed_at', { ascending: false }).limit(50)
          : query.order('created_at', { ascending: true })
      const { data, error } = await query
      if (error) throw toDataError(error, 'load your tasks')
      return (data as TaskRow[]).map(toTask)
    },

    async create({ contextId, title: rawTitle }) {
      const title = trimmed(rawTitle, 'task', 200)
      const id = crypto.randomUUID()
      const { data, error } = await client
        .from('tasks')
        .insert({ id, context_id: contextId, title })
        .select(taskColumns)
        .single()
      if (!error) return toTask(data as TaskRow)
      if (isDuplicate(error, 'tasks_pkey')) {
        const existing = await client.from('tasks').select(taskColumns).eq('id', id).single()
        if (!existing.error) return toTask(existing.data as TaskRow)
      }
      throw toDataError(error, 'add the task')
    },

    async setDone(id, done) {
      // The database records when a task was completed; the app never sets it.
      const { data, error } = await client
        .from('tasks')
        .update({ status: done ? 'done' : 'open' })
        .eq('id', id)
        .select(taskColumns)
        .single()
      if (error) throw toDataError(error, done ? 'complete the task' : 'reopen the task')
      return toTask(data as TaskRow)
    },
  }
}

export function createSupabaseDataServices(client: SupabaseClient): DataServices {
  return { contexts: contextsService(client), tasks: tasksService(client) }
}
