import { noteChangesToRow, projectTaskOrder, taskChangesToRow } from '../data/supabaseData'
import {
  DataError,
  limits,
  type Context,
  type DataServices,
  type Note,
  type NoteDoc,
  type NoteSummary,
  type Priority,
  type Project,
  type Task,
  type TaskView,
} from '../data/types'
import { localDateString } from '../lib/deadlines'
import { noteText } from '../lib/noteText'

// An in-memory stand-in for the database, so the screens can be tested on a
// machine with no Supabase. It copies only the behaviour the screens rely on.
// It proves nothing about the real database or its security rules.

const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

/** A task's deadline day, for ordering the imitation summary. */
const deadlineDay = (task: Task) =>
  !task.deadline ? null : task.deadline.kind === 'date' ? task.deadline.date : localDateString(new Date(task.deadline.at))

/** The same rule as the database's private.note_text. */
export const fakeNoteText = noteText

/** A one-paragraph note document, for tests. */
export const paragraphDoc = (text: string): NoteDoc => ({
  type: 'doc',
  // The editor never stores an empty text node; an empty note is an empty paragraph.
  content: [text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }],
})

let clock = Date.parse('2026-10-14T09:00:00Z')
const now = () => new Date((clock += 1000)).toISOString()

export class FakeData implements DataServices {
  contextRows: Context[] = []
  projectRows: Project[] = []
  taskRows: Task[] = []
  noteRows: Note[] = []
  /** When set, the next write fails with this error (then clears). */
  failNextWrite: DataError | null = null
  /** While set, every write fails with this error (for example, while offline). */
  failWrites: DataError | null = null
  /** While set, every read fails with this error. */
  failReads: DataError | null = null

  private takeFailure() {
    const failure = this.failNextWrite ?? this.failWrites
    this.failNextWrite = null
    if (failure) throw failure
  }

  private checkRead() {
    if (this.failReads) throw this.failReads
  }

  private findTask(id: string) {
    const task = this.taskRows.find((entry) => entry.id === id)
    if (!task) throw new DataError('missing', 'Could not change the task: it no longer exists.')
    return task
  }

  private findContext(id: string) {
    const context = this.contextRows.find((entry) => entry.id === id)
    if (!context) throw new DataError('missing', 'Could not change the context: it no longer exists.')
    return context
  }

  private findProject(id: string) {
    const project = this.projectRows.find((entry) => entry.id === id)
    if (!project) throw new DataError('missing', 'Could not change it: its project no longer exists.')
    return project
  }

  /** Like the database's rule: one active project per name, ignoring case and outer spaces. */
  private nameTaken(name: string, exceptId?: string) {
    const key = name.trim().toLowerCase()
    return this.projectRows.some((project) => !project.archivedAt && project.id !== exceptId && project.name.trim().toLowerCase() === key)
  }

  addProject(name: string, changes: Partial<Project> = {}): Project {
    const stamp = now()
    const project: Project = { id: crypto.randomUUID(), name, contextId: null, createdAt: stamp, updatedAt: stamp, archivedAt: null, ...changes }
    this.projectRows.push(project)
    return project
  }

  addContext(name: string, showOnTv = false): Context {
    const context = { id: crypto.randomUUID(), name, showOnTv, archivedAt: null, createdAt: now() }
    this.contextRows.push(context)
    return context
  }

  addTask(contextId: string, title: string, changes: Partial<Task> = {}): Task {
    const stamp = now()
    const task: Task = {
      id: crypto.randomUUID(),
      contextId,
      projectId: null,
      title,
      notes: null,
      status: 'open',
      priority: 'medium',
      hideFromTv: false,
      deadline: null,
      completedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
      archivedAt: null,
      ...changes,
    }
    this.taskRows.push(task)
    return task
  }

  contexts: DataServices['contexts'] = {
    list: async ({ includeArchived = false } = {}) => {
      this.checkRead()
      return this.contextRows.filter((context) => includeArchived || !context.archivedAt).map((context) => ({ ...context }))
    },
    create: async (name) => {
      this.takeFailure()
      const trimmed = name.trim()
      if (!trimmed) throw new DataError('invalid', 'Give the context a name.')
      return { ...this.addContext(trimmed) }
    },
    rename: async (id, name) => {
      this.takeFailure()
      const context = this.findContext(id)
      context.name = name.trim()
      return { ...context }
    },
    setShowOnTv: async (id, showOnTv) => {
      this.takeFailure()
      const context = this.findContext(id)
      context.showOnTv = showOnTv
      return { ...context }
    },
    setArchived: async (id, archived) => {
      this.takeFailure()
      const context = this.findContext(id)
      context.archivedAt = archived ? now() : null
      return { ...context }
    },
  }

  /**
   * An imitation of the projects table. Ownership, the second factor and the
   * same-owner links are the database's job and are proved by the security
   * checks, never by this.
   */
  projects: DataServices['projects'] = {
    list: async ({ includeArchived = false } = {}) => {
      this.checkRead()
      return this.projectRows
        .filter((project) => includeArchived || !project.archivedAt)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((project) => ({ ...project }))
    },
    get: async (id) => {
      this.checkRead()
      return { ...this.findProject(id) }
    },
    create: async ({ name, contextId = null }, options = {}) => {
      const trimmed = name.trim()
      if (!trimmed) throw new DataError('invalid', 'Give the project a name.')
      if (trimmed.length > limits.projectName) throw new DataError('invalid', `Keep the project to ${limits.projectName} characters.`)
      this.takeFailure()
      const existing = options.id && this.projectRows.find((entry) => entry.id === options.id)
      if (existing) return { ...existing }
      if (contextId) this.findContext(contextId)
      if (this.nameTaken(trimmed)) throw new DataError('invalid', 'You already have an active project with that name. Choose another.')
      return { ...this.addProject(trimmed, { contextId, ...(options.id ? { id: options.id } : {}) }) }
    },
    rename: async (id, name) => {
      const trimmed = name.trim()
      if (!trimmed) throw new DataError('invalid', 'Give the project a name.')
      this.takeFailure()
      const project = this.findProject(id)
      if (!project.archivedAt && this.nameTaken(trimmed, id)) {
        throw new DataError('invalid', 'You already have an active project with that name. Choose another.')
      }
      project.name = trimmed
      project.updatedAt = now()
      return { ...project }
    },
    setContext: async (id, contextId) => {
      this.takeFailure()
      const project = this.findProject(id)
      if (contextId) this.findContext(contextId)
      project.contextId = contextId
      project.updatedAt = now()
      return { ...project }
    },
    setArchived: async (id, archived) => {
      this.takeFailure()
      const project = this.findProject(id)
      if (!archived && this.nameTaken(project.name, id)) {
        throw new DataError('invalid', 'Another active project already has this name. Rename one of them first.')
      }
      project.archivedAt = archived ? now() : null
      project.updatedAt = now()
      return { ...project }
    },
    contents: async (id) => {
      this.checkRead()
      this.findProject(id)
      return {
        notes: this.noteRows
          .filter((note) => note.projectId === id && !note.archivedAt)
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
          .map((note) => this.noteSummary(note)),
        tasks: this.taskRows
          .filter((task) => task.projectId === id && !task.archivedAt)
          .map((task) => ({ ...task }))
          .sort(projectTaskOrder),
      }
    },
  }

  tasks: DataServices['tasks'] = {
    list: async (view: TaskView) => {
      this.checkRead()
      return this.taskRows
        .filter((task) => (view === 'archived' ? task.archivedAt : task.status === view && !task.archivedAt))
        .sort((a, b) => {
          if (view === 'archived') return (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')
          if (view === 'done') return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
          return a.createdAt.localeCompare(b.createdAt)
        })
        .map((task) => ({ ...task }))
    },
    completedSince: async (since) => {
      this.checkRead()
      return this.taskRows
        .filter((task) => task.status === 'done' && !task.archivedAt && task.completedAt && task.completedAt >= since.toISOString())
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .map((task) => ({ ...task }))
    },
    create: async ({ contextId, title, projectId = null }) => {
      this.takeFailure()
      this.findContext(contextId)
      if (projectId) this.findProject(projectId)
      return { ...this.addTask(contextId, title.trim(), { projectId }) }
    },
    update: async (id, changes) => {
      // The same checks as the real data layer, before anything is changed.
      taskChangesToRow(changes)
      this.takeFailure()
      const task = this.findTask(id)
      if (changes.contextId !== undefined) this.findContext(changes.contextId)
      if (changes.projectId) this.findProject(changes.projectId)
      if (changes.projectId !== undefined) task.projectId = changes.projectId
      if (changes.title !== undefined) task.title = changes.title.trim()
      if (changes.notes !== undefined) task.notes = changes.notes?.trim() || null
      if (changes.priority !== undefined) task.priority = changes.priority
      if (changes.contextId !== undefined) task.contextId = changes.contextId
      if (changes.hideFromTv !== undefined) task.hideFromTv = changes.hideFromTv
      if (changes.deadline !== undefined) task.deadline = changes.deadline
      task.updatedAt = now()
      return { ...task }
    },
    setDone: async (id, done) => {
      this.takeFailure()
      const task = this.findTask(id)
      task.status = done ? 'done' : 'open'
      task.completedAt = done ? now() : null
      task.updatedAt = now()
      return { ...task }
    },
    setArchived: async (id, archived) => {
      this.takeFailure()
      const task = this.findTask(id)
      task.archivedAt = archived ? now() : null
      task.updatedAt = now()
      return { ...task }
    },
    setProject: async (id, projectId) => {
      this.takeFailure()
      const task = this.findTask(id)
      if (projectId) this.findProject(projectId)
      task.projectId = projectId
      task.updatedAt = now()
      return { ...task }
    },
  }

  /**
   * An imitation of the database function tv_summary(), so TV screens can be
   * tested here. The real filtering happens in PostgreSQL and is proved by
   * the security checks, never by this.
   */
  summary: DataServices['summary'] = {
    get: async () => {
      this.checkRead()
      return {
      generatedAt: now(),
      tasks: this.taskRows
        .filter((task) => {
          const context = this.contextRows.find((entry) => entry.id === task.contextId)
          return task.status === 'open' && !task.archivedAt && !task.hideFromTv && context?.showOnTv && !context.archivedAt
        })
        .sort((a, b) => {
          const [dayA, dayB] = [deadlineDay(a), deadlineDay(b)]
          if (dayA !== dayB) return dayA === null ? 1 : dayB === null ? -1 : dayA.localeCompare(dayB)
          const atA = a.deadline?.kind === 'time' ? a.deadline.at : ''
          const atB = b.deadline?.kind === 'time' ? b.deadline.at : ''
          return priorityRank[a.priority] - priorityRank[b.priority] || atA.localeCompare(atB) || a.createdAt.localeCompare(b.createdAt)
        })
        .slice(0, 50)
        .map((task) => ({
          title: task.title,
          context: this.contextRows.find((entry) => entry.id === task.contextId)!.name,
          priority: task.priority,
          deadline: task.deadline,
        })),
      }
    },
  }

  addNote(
    changes: { title?: string; text?: string; contextId?: string | null; projectId?: string | null; pinned?: boolean; archivedAt?: string | null } = {},
  ): Note {
    const stamp = now()
    const content = paragraphDoc(changes.text ?? '')
    const text = fakeNoteText(content).trim()
    const note: Note = {
      id: crypto.randomUUID(),
      title: changes.title ?? '',
      contextId: changes.contextId ?? null,
      projectId: changes.projectId ?? null,
      pinned: changes.pinned ?? false,
      preview: text.slice(0, 200),
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
      archivedAt: changes.archivedAt ?? null,
      content,
      text,
    }
    this.noteRows.push(note)
    return note
  }

  private findNote(id: string) {
    const note = this.noteRows.find((entry) => entry.id === id)
    if (!note) throw new DataError('missing', 'Could not change the note: it no longer exists.')
    return note
  }

  /** Applies edits as the database would: derived text, revision and edit time follow real edits only. */
  private applyNoteChanges(note: Note, changes: Parameters<DataServices['notes']['save']>[1]) {
    if (changes.contextId) this.findContext(changes.contextId)
    const edited =
      (changes.title !== undefined && changes.title !== note.title) ||
      (changes.content !== undefined && JSON.stringify(changes.content) !== JSON.stringify(note.content)) ||
      (changes.contextId !== undefined && changes.contextId !== note.contextId)
    if (changes.title !== undefined) note.title = changes.title
    if (changes.content !== undefined) note.content = changes.content
    if (changes.contextId !== undefined) note.contextId = changes.contextId
    note.text = fakeNoteText(note.content).trim()
    note.preview = note.text.slice(0, 200)
    if (edited) {
      note.revision += 1
      note.updatedAt = now()
    }
  }

  private noteSummary(note: Note): NoteSummary {
    return {
      id: note.id,
      title: note.title,
      contextId: note.contextId,
      projectId: note.projectId,
      pinned: note.pinned,
      preview: note.preview,
      revision: note.revision,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      archivedAt: note.archivedAt,
    }
  }

  /**
   * An imitation of the notes table and search_notes(), so screens can be
   * tested here. Access rules, derived text and search ranking are the
   * database's job and are proved by the security checks, never by this.
   */
  notes: DataServices['notes'] = {
    list: async ({ archived = false, projectId } = {}) => {
      this.checkRead()
      return this.noteRows
        .filter((note) => Boolean(note.archivedAt) === archived)
        .filter((note) => projectId === undefined || note.projectId === projectId)
        .sort((a, b) =>
          archived
            ? (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')
            : Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
        )
        .map((note) => this.noteSummary(note))
    },
    get: async (id) => {
      this.checkRead()
      return structuredClone(this.findNote(id))
    },
    peek: async (id) => {
      this.checkRead()
      const note = this.findNote(id)
      return { id: note.id, revision: note.revision, updatedAt: note.updatedAt, pinned: note.pinned, archivedAt: note.archivedAt }
    },
    create: async (changes = {}, options = {}) => {
      noteChangesToRow(changes)
      this.takeFailure()
      // Like the database's primary key: the same id never makes a second note.
      const existing = options.id && this.noteRows.find((entry) => entry.id === options.id)
      if (existing) return structuredClone(existing)
      if (options.projectId) this.findProject(options.projectId)
      const note = this.addNote({ contextId: changes.contextId ?? null, projectId: options.projectId ?? null })
      if (options.id) note.id = options.id
      this.applyNoteChanges(note, { title: changes.title, content: changes.content })
      note.revision = 1
      return structuredClone(note)
    },
    save: async (id, changes, baseRevision) => {
      const row = noteChangesToRow(changes)
      if (Object.keys(row).length === 0) throw new DataError('invalid', 'There were no changes to save.')
      this.takeFailure()
      const note = this.findNote(id)
      if (note.revision !== baseRevision) {
        throw new DataError('conflict', 'This note was changed on another device since you opened it. Nothing was overwritten.')
      }
      this.applyNoteChanges(note, changes)
      return structuredClone(note)
    },
    setPinned: async (id, pinned) => {
      this.takeFailure()
      const note = this.findNote(id)
      note.pinned = pinned
      return this.noteSummary(note)
    },
    setArchived: async (id, archived) => {
      this.takeFailure()
      const note = this.findNote(id)
      note.archivedAt = archived ? now() : null
      return this.noteSummary(note)
    },
    // Like the database: moving a note is not an edit, so revision and edit time stay.
    setProject: async (id, projectId) => {
      this.takeFailure()
      const note = this.findNote(id)
      if (projectId) this.findProject(projectId)
      note.projectId = projectId
      return this.noteSummary(note)
    },
    search: async (text, { includeArchived = false, contextId, projectId, pinnedOnly = false } = {}) => {
      if (text.length > limits.noteSearch) throw new DataError('invalid', `Keep searches to ${limits.noteSearch} characters.`)
      this.checkRead()
      const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
      if (words.length === 0) return []
      const matches = (value: string) => {
        const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
        return words.every((word) => tokens.some((token) => token.startsWith(word)))
      }
      return this.noteRows
        .filter((note) => (includeArchived || !note.archivedAt) && (!contextId || note.contextId === contextId))
        .filter((note) => (projectId === undefined || note.projectId === projectId) && (!pinnedOnly || note.pinned))
        .filter((note) => matches(`${note.title} ${note.text}`))
        .sort((a, b) => Number(matches(b.title)) - Number(matches(a.title)) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 50)
        .map((note) => ({
          id: note.id,
          title: note.title,
          contextId: note.contextId,
          projectId: note.projectId,
          pinned: note.pinned,
          archivedAt: note.archivedAt,
          updatedAt: note.updatedAt,
          snippet: note.text
            .split(/(\s+)/)
            .slice(0, 48)
            .map((piece) => ({ text: piece, match: words.some((word) => piece.toLowerCase().startsWith(word)) })),
        }))
    },
  }
}
