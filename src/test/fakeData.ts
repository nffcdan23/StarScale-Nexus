import { noteChangesToRow, taskChangesToRow } from '../data/supabaseData'
import {
  DataError,
  limits,
  type Context,
  type DataServices,
  type Note,
  type NoteDoc,
  type NoteSummary,
  type Priority,
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
    create: async ({ contextId, title }) => {
      this.takeFailure()
      this.findContext(contextId)
      return { ...this.addTask(contextId, title.trim()) }
    },
    update: async (id, changes) => {
      // The same checks as the real data layer, before anything is changed.
      taskChangesToRow(changes)
      this.takeFailure()
      const task = this.findTask(id)
      if (changes.contextId !== undefined) this.findContext(changes.contextId)
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

  addNote(changes: { title?: string; text?: string; contextId?: string | null; pinned?: boolean; archivedAt?: string | null } = {}): Note {
    const stamp = now()
    const content = paragraphDoc(changes.text ?? '')
    const text = fakeNoteText(content).trim()
    const note: Note = {
      id: crypto.randomUUID(),
      title: changes.title ?? '',
      contextId: changes.contextId ?? null,
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
    list: async ({ archived = false } = {}) => {
      this.checkRead()
      return this.noteRows
        .filter((note) => Boolean(note.archivedAt) === archived)
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
      const note = this.addNote({ contextId: changes.contextId ?? null })
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
    search: async (text, { includeArchived = false, contextId } = {}) => {
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
        .filter((note) => matches(`${note.title} ${note.text}`))
        .sort((a, b) => Number(matches(b.title)) - Number(matches(a.title)) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 50)
        .map((note) => ({
          id: note.id,
          title: note.title,
          contextId: note.contextId,
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
