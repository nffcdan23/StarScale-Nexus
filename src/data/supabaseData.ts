import type { SupabaseClient } from '@supabase/supabase-js'
import { slugFor } from './slug'
import {
  DataError,
  type Context,
  type ContextsService,
  type DataServices,
  type Task,
  type TaskChanges,
  type TasksService,
  type TaskView,
  limits,
} from './types'

// The only code that reads or writes contexts and tasks. Every request runs
// with the signed-in owner's own session; the database decides what is
// allowed.

const contextColumns = 'id, name, show_on_tv, archived_at, created_at'
const taskColumns =
  'id, context_id, title, notes, status, priority, hide_from_tv, due_on, due_at, completed_at, created_at, updated_at, archived_at'

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
  due_on: string | null
  due_at: string | null
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
  deadline: row.due_on ? { kind: 'date', date: row.due_on } : row.due_at ? { kind: 'time', at: row.due_at } : null,
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
      const name = trimmed(rawName, 'context', limits.contextName)
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

    rename: (id, rawName) => update(id, { name: trimmed(rawName, 'context', limits.contextName) }, 'rename the context'),
    setShowOnTv: (id, showOnTv) => update(id, { show_on_tv: showOnTv }, 'change the TV setting'),
    setArchived: (id, archived) =>
      update(id, { archived_at: archived ? new Date().toISOString() : null }, archived ? 'archive the context' : 'restore the context'),
  }
}

/** Turns the owner's edits into database columns, checking them first. */
export function taskChangesToRow(changes: TaskChanges): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (changes.title !== undefined) row.title = trimmed(changes.title, 'task', limits.taskTitle)
  if (changes.notes !== undefined) {
    const notes = changes.notes?.trim() ?? ''
    if (notes.length > limits.taskNotes) throw new DataError('invalid', `Keep the notes to ${limits.taskNotes} characters.`)
    row.notes = notes || null
  }
  if (changes.priority !== undefined) row.priority = changes.priority
  if (changes.contextId !== undefined) row.context_id = changes.contextId
  if (changes.hideFromTv !== undefined) row.hide_from_tv = changes.hideFromTv
  if (changes.deadline !== undefined) {
    // Both columns are always sent together, so switching between a date and a
    // time happens in one step and never breaks the one-kind-of-deadline rule.
    const deadline = changes.deadline
    row.due_on = deadline?.kind === 'date' ? deadline.date : null
    row.due_at = deadline?.kind === 'time' ? deadline.at : null
  }
  return row
}

function tasksService(client: SupabaseClient): TasksService {
  const update = async (id: string, changes: Record<string, unknown>, action: string) => {
    const { data, error } = await client.from('tasks').update(changes).eq('id', id).select(taskColumns).single()
    if (error) throw toDataError(error, action)
    return toTask(data as TaskRow)
  }

  return {
    async list(view: TaskView) {
      let query = client.from('tasks').select(taskColumns)
      if (view === 'archived') {
        query = query.not('archived_at', 'is', null).order('archived_at', { ascending: false }).limit(100)
      } else if (view === 'done') {
        query = query.eq('status', 'done').is('archived_at', null).order('completed_at', { ascending: false }).limit(50)
      } else {
        query = query.eq('status', 'open').is('archived_at', null).order('created_at', { ascending: true })
      }
      const { data, error } = await query
      if (error) throw toDataError(error, 'load your tasks')
      return (data as TaskRow[]).map(toTask)
    },

    async create({ contextId, title: rawTitle }) {
      const title = trimmed(rawTitle, 'task', limits.taskTitle)
      // The id is made here, so a retried request can never create a second copy.
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

    async update(id, changes) {
      const row = taskChangesToRow(changes)
      if (Object.keys(row).length === 0) throw new DataError('invalid', 'There were no changes to save.')
      return update(id, row, 'save the task')
    },

    // The database records when a task was completed; the app never sets it.
    setDone: (id, done) => update(id, { status: done ? 'done' : 'open' }, done ? 'complete the task' : 'reopen the task'),

    setArchived: (id, archived) =>
      update(id, { archived_at: archived ? new Date().toISOString() : null }, archived ? 'archive the task' : 'restore the task'),
  }
}

export function createSupabaseDataServices(client: SupabaseClient): DataServices {
  return { contexts: contextsService(client), tasks: tasksService(client) }
}
