import { taskChangesToRow } from '../data/supabaseData'
import { DataError, type Context, type DataServices, type Priority, type Task, type TaskView } from '../data/types'
import { localDateString } from '../lib/deadlines'

// An in-memory stand-in for the database, so the screens can be tested on a
// machine with no Supabase. It copies only the behaviour the screens rely on.
// It proves nothing about the real database or its security rules.

const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

/** A task's deadline day, for ordering the imitation summary. */
const deadlineDay = (task: Task) =>
  !task.deadline ? null : task.deadline.kind === 'date' ? task.deadline.date : localDateString(new Date(task.deadline.at))

let clock = Date.parse('2026-10-14T09:00:00Z')
const now = () => new Date((clock += 1000)).toISOString()

export class FakeData implements DataServices {
  contextRows: Context[] = []
  taskRows: Task[] = []
  /** When set, the next write fails with this error (then clears). */
  failNextWrite: DataError | null = null
  /** While set, every read fails with this error. */
  failReads: DataError | null = null

  private takeFailure() {
    const failure = this.failNextWrite
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
}
