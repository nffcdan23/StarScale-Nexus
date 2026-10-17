import type { SupabaseClient } from '@supabase/supabase-js'
import { slugFor } from './slug'
import {
  DataError,
  type Context,
  type ContextsService,
  type DataServices,
  type Note,
  type NoteChanges,
  type NoteDoc,
  type NoteSearchResult,
  type NotesService,
  type NoteSummary,
  type NoteVersion,
  type Project,
  type ProjectContents,
  type ProjectsService,
  type SnippetPart,
  type Task,
  type TaskChanges,
  type SummaryService,
  type TasksService,
  type TaskView,
  type TvSummary,
  type TvTask,
  limits,
} from './types'

// The only code that reads or writes contexts, projects, tasks and notes.
// Every request runs with the signed-in owner's own session; the database
// decides what is allowed.

const contextColumns = 'id, name, show_on_tv, archived_at, created_at'
const taskColumns =
  'id, context_id, project_id, title, notes, status, priority, hide_from_tv, due_on, due_at, completed_at, created_at, updated_at, archived_at'
const projectColumns = 'id, name, context_id, created_at, updated_at, archived_at'

interface ProjectRow {
  id: string
  name: string
  context_id: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  contextId: row.context_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
})

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
  project_id: string | null
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
  projectId: row.project_id,
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
  if (code === '23503') {
    const what = /_project_same_owner/.test(message) ? 'project' : 'context'
    return new DataError('missing', `Could not ${action}: its ${what} no longer exists.`)
  }
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
  if (changes.projectId !== undefined) row.project_id = changes.projectId
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

    async completedSince(since) {
      const { data, error } = await client
        .from('tasks')
        .select(taskColumns)
        .eq('status', 'done')
        .is('archived_at', null)
        .gte('completed_at', since.toISOString())
        .order('completed_at', { ascending: false })
      if (error) throw toDataError(error, 'load your completed tasks')
      return (data as TaskRow[]).map(toTask)
    },

    async create({ contextId, title: rawTitle, projectId = null }) {
      const title = trimmed(rawTitle, 'task', limits.taskTitle)
      // The id is made here, so a retried request can never create a second copy.
      const id = crypto.randomUUID()
      const { data, error } = await client
        .from('tasks')
        .insert({ id, context_id: contextId, title, ...(projectId ? { project_id: projectId } : {}) })
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

    setProject: (id, projectId) => update(id, { project_id: projectId }, projectId ? 'move the task to the project' : 'take the task out of its project'),
  }
}

/** Open tasks oldest first, then completed tasks newest first: how a project shows its tasks. */
export function projectTaskOrder(a: Task, b: Task): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1
  return a.status === 'open' ? a.createdAt.localeCompare(b.createdAt) : (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
}

function projectsService(client: SupabaseClient): ProjectsService {
  const duplicateName = new DataError('invalid', 'You already have an active project with that name. Choose another.')

  const update = async (id: string, changes: Record<string, unknown>, action: string) => {
    const { data, error } = await client.from('projects').update(changes).eq('id', id).select(projectColumns).single()
    if (isDuplicate(error, 'projects_active_name_unique')) throw duplicateName
    if (error) throw toDataError(error, action)
    return toProject(data as ProjectRow)
  }

  return {
    async list({ includeArchived = false } = {}) {
      let query = client.from('projects').select(projectColumns).order('name')
      if (!includeArchived) query = query.is('archived_at', null)
      const { data, error } = await query
      if (error) throw toDataError(error, 'load your projects')
      return (data as ProjectRow[]).map(toProject)
    },

    async get(id) {
      const { data, error } = await client.from('projects').select(projectColumns).eq('id', id).single()
      if (error) throw toDataError(error, 'open the project')
      return toProject(data as ProjectRow)
    },

    async create({ name: rawName, contextId = null }, options = {}) {
      const name = trimmed(rawName, 'project', limits.projectName)
      // The id is made on the device (or given), so a retried request can never create a second copy.
      const id = options.id ?? crypto.randomUUID()
      const { data, error } = await client
        .from('projects')
        .insert({ id, name, context_id: contextId })
        .select(projectColumns)
        .single()
      if (!error) return toProject(data as ProjectRow)
      if (isDuplicate(error, 'projects_pkey')) {
        const existing = await client.from('projects').select(projectColumns).eq('id', id).single()
        if (!existing.error) return toProject(existing.data as ProjectRow)
      }
      if (isDuplicate(error, 'projects_active_name_unique')) throw duplicateName
      throw toDataError(error, 'create the project')
    },

    rename: (id, rawName) => update(id, { name: trimmed(rawName, 'project', limits.projectName) }, 'rename the project'),
    setContext: (id, contextId) => update(id, { context_id: contextId }, 'change the project’s context'),
    async setArchived(id, archived) {
      try {
        return await update(id, { archived_at: archived ? new Date().toISOString() : null }, archived ? 'archive the project' : 'restore the project')
      } catch (error) {
        if (error === duplicateName) {
          throw new DataError('invalid', 'Another active project already has this name. Rename one of them first.')
        }
        throw error
      }
    },

    async contents(id): Promise<ProjectContents> {
      const [notes, tasks] = await Promise.all([
        client
          .from('notes')
          .select(noteSummaryColumns)
          .eq('project_id', id)
          .is('archived_at', null)
          .order('pinned', { ascending: false })
          .order('updated_at', { ascending: false }),
        client.from('tasks').select(taskColumns).eq('project_id', id).is('archived_at', null),
      ])
      if (notes.error) throw toDataError(notes.error, 'load the project’s notes')
      if (tasks.error) throw toDataError(tasks.error, 'load the project’s tasks')
      return {
        notes: (notes.data as NoteSummaryRow[]).map(toNoteSummary),
        tasks: (tasks.data as TaskRow[]).map(toTask).sort(projectTaskOrder),
      }
    },
  }
}

const priorities = new Set(['low', 'medium', 'high'])
const isText = (value: unknown): value is string => typeof value === 'string'

/**
 * Reads the summary exactly as the database sent it. Anything unexpected is
 * refused rather than guessed at, so the TV never shows a half-understood reply.
 */
export function toTvSummary(value: unknown): TvSummary {
  const reply = value as { generated_at?: unknown; tasks?: unknown } | null
  if (!reply || !isText(reply.generated_at) || !Array.isArray(reply.tasks)) {
    throw new DataError('unknown', 'Could not read the summary: the database replied in an unexpected form.')
  }
  const tasks = reply.tasks.map((entry): TvTask => {
    const task = entry as Record<string, unknown>
    const dueOn = task.due_on ?? null
    const dueAt = task.due_at ?? null
    if (
      !isText(task.title) ||
      !isText(task.context) ||
      !priorities.has(task.priority as string) ||
      (dueOn !== null && !isText(dueOn)) ||
      (dueAt !== null && !isText(dueAt))
    ) {
      throw new DataError('unknown', 'Could not read the summary: the database replied in an unexpected form.')
    }
    return {
      title: task.title,
      context: task.context,
      priority: task.priority as TvTask['priority'],
      deadline: dueOn ? { kind: 'date', date: dueOn } : dueAt ? { kind: 'time', at: dueAt } : null,
    }
  })
  return { generatedAt: reply.generated_at, tasks }
}

function summaryService(client: SupabaseClient): SummaryService {
  return {
    // Which tasks appear, and which fields, is decided by the database
    // function tv_summary(); nothing is filtered or removed here.
    async get() {
      const { data, error } = await client.rpc('tv_summary')
      if (error) throw toDataError(error, 'load the summary')
      return toTvSummary(data)
    },
  }
}

const noteSummaryColumns = 'id, context_id, project_id, title, preview, pinned, revision, created_at, updated_at, archived_at'
const noteColumns = `${noteSummaryColumns}, content, content_text`

interface NoteSummaryRow {
  id: string
  context_id: string | null
  project_id: string | null
  title: string
  preview: string
  pinned: boolean
  revision: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

interface NoteRow extends NoteSummaryRow {
  content: unknown
  content_text: string
}

const toNoteSummary = (row: NoteSummaryRow): NoteSummary => ({
  id: row.id,
  title: row.title,
  contextId: row.context_id,
  projectId: row.project_id,
  pinned: row.pinned,
  preview: row.preview,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
})

const isNoteDoc = (value: unknown): value is NoteDoc =>
  typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'doc'

function toNote(row: NoteRow): Note {
  if (!isNoteDoc(row.content)) throw new DataError('unknown', 'Could not read the note: it is not in the expected form.')
  return { ...toNoteSummary(row), content: row.content, text: row.content_text }
}

const MATCH_START = '\uE000'
const MATCH_END = '\uE001'

/**
 * Splits a search snippet at the database's match markers (the private-use
 * characters U+E000 and U+E001) into plain parts. The result is shown as
 * text, never as HTML.
 */
export function toSnippet(value: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  const add = (text: string, match: boolean) => {
    const clean = text.replaceAll(MATCH_START, '').replaceAll(MATCH_END, '')
    if (clean) parts.push({ text: clean, match })
  }
  value.split(MATCH_START).forEach((piece, index) => {
    if (index === 0) return add(piece, false)
    const end = piece.indexOf(MATCH_END)
    if (end === -1) return add(piece, false)
    add(piece.slice(0, end), true)
    add(piece.slice(end + 1), false)
  })
  return parts
}

/** Turns the owner's note edits into database columns, checking them first. */
export function noteChangesToRow(changes: NoteChanges): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (changes.title !== undefined) {
    if (changes.title.length > limits.noteTitle) throw new DataError('invalid', `Keep the title to ${limits.noteTitle} characters.`)
    row.title = changes.title
  }
  if (changes.content !== undefined) {
    if (!isNoteDoc(changes.content)) throw new DataError('invalid', 'Could not save the note: its content is not in the expected form.')
    if (new TextEncoder().encode(JSON.stringify(changes.content)).length > limits.noteContentBytes) {
      throw new DataError('invalid', 'This note is too long to save. Split it into two notes.')
    }
    row.content = changes.content
  }
  if (changes.contextId !== undefined) row.context_id = changes.contextId
  return row
}

function notesService(client: SupabaseClient): NotesService {
  const update = async (id: string, changes: Record<string, unknown>, action: string) => {
    const { data, error } = await client.from('notes').update(changes).eq('id', id).select(noteSummaryColumns).single()
    if (error) throw toDataError(error, action)
    return toNoteSummary(data as NoteSummaryRow)
  }

  return {
    async list({ archived = false, projectId } = {}) {
      let query = client.from('notes').select(noteSummaryColumns)
      if (projectId === null) query = query.is('project_id', null)
      else if (projectId !== undefined) query = query.eq('project_id', projectId)
      query = archived
        ? query.not('archived_at', 'is', null).order('archived_at', { ascending: false })
        : query.is('archived_at', null).order('pinned', { ascending: false }).order('updated_at', { ascending: false })
      const { data, error } = await query
      if (error) throw toDataError(error, 'load your notes')
      return (data as NoteSummaryRow[]).map(toNoteSummary)
    },

    async get(id) {
      const { data, error } = await client.from('notes').select(noteColumns).eq('id', id).single()
      if (error) throw toDataError(error, 'open the note')
      return toNote(data as NoteRow)
    },

    async peek(id) {
      const { data, error } = await client.from('notes').select('id, revision, updated_at, pinned, archived_at').eq('id', id).single()
      if (error) throw toDataError(error, 'check the note')
      const row = data as { id: string; revision: number; updated_at: string; pinned: boolean; archived_at: string | null }
      return { id: row.id, revision: row.revision, updatedAt: row.updated_at, pinned: row.pinned, archivedAt: row.archived_at } satisfies NoteVersion
    },

    async create(changes = {}, options = {}) {
      const row = noteChangesToRow(changes)
      // The id is made on the device (or given by the caller), so a retried
      // request can never create a second copy.
      const id = options.id ?? crypto.randomUUID()
      const { data, error } = await client
        .from('notes')
        .insert({ id, ...row, ...(options.projectId ? { project_id: options.projectId } : {}) })
        .select(noteColumns)
        .single()
      if (!error) return toNote(data as NoteRow)
      if (isDuplicate(error, 'notes_pkey')) {
        const existing = await client.from('notes').select(noteColumns).eq('id', id).single()
        if (!existing.error) return toNote(existing.data as NoteRow)
      }
      throw toDataError(error, 'create the note')
    },

    async save(id, changes, baseRevision) {
      const row = noteChangesToRow(changes)
      if (Object.keys(row).length === 0) throw new DataError('invalid', 'There were no changes to save.')
      // Only saves if nobody else has saved since this version was loaded.
      const { data, error } = await client
        .from('notes')
        .update(row)
        .eq('id', id)
        .eq('revision', baseRevision)
        .select(noteColumns)
        .maybeSingle()
      if (error) throw toDataError(error, 'save the note')
      if (data) return toNote(data as NoteRow)

      const current = await client.from('notes').select('id, revision').eq('id', id).maybeSingle()
      if (current.error) throw toDataError(current.error, 'save the note')
      if (!current.data) throw new DataError('missing', 'Could not save the note: it no longer exists.')
      throw new DataError('conflict', 'This note was changed on another device since you opened it. Nothing was overwritten.')
    },

    setPinned: (id, pinned) => update(id, { pinned }, pinned ? 'pin the note' : 'unpin the note'),
    setArchived: (id, archived) =>
      update(id, { archived_at: archived ? new Date().toISOString() : null }, archived ? 'archive the note' : 'restore the note'),

    // Not an edit: the database leaves the revision and edit time alone.
    setProject: (id, projectId) =>
      update(id, { project_id: projectId }, projectId ? 'move the note to the project' : 'move the note to the Inbox'),

    async search(text, { includeArchived = false, contextId, projectId, pinnedOnly = false } = {}) {
      if (text.length > limits.noteSearch) throw new DataError('invalid', `Keep searches to ${limits.noteSearch} characters.`)
      if (!text.trim()) return []
      const { data, error } = await client.rpc('search_notes', {
        search_text: text,
        include_archived: includeArchived,
        context_filter: contextId ?? null,
        // Sent only when used, so a plain search is exactly the earlier call.
        ...(projectId ? { project_filter: projectId } : {}),
        ...(projectId === null ? { inbox_only: true } : {}),
        ...(pinnedOnly ? { pinned_only: true } : {}),
      })
      if (error) throw toDataError(error, 'search your notes')
      return (data as Array<NoteSummaryRow & { snippet: string | null }>).map(
        (row): NoteSearchResult => ({
          id: row.id,
          title: row.title,
          contextId: row.context_id,
          projectId: row.project_id,
          pinned: row.pinned,
          archivedAt: row.archived_at,
          updatedAt: row.updated_at,
          snippet: toSnippet(row.snippet ?? ''),
        }),
      )
    },
  }
}

export function createSupabaseDataServices(client: SupabaseClient): DataServices {
  return {
    contexts: contextsService(client),
    projects: projectsService(client),
    tasks: tasksService(client),
    summary: summaryService(client),
    notes: notesService(client),
  }
}
