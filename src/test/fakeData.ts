import { DataError, type Context, type DataServices, type Task, type TaskStatus } from '../data/types'

// An in-memory stand-in for the database, so the screens can be tested on a
// machine with no Supabase. It copies only the behaviour the screens rely on.
// It proves nothing about the real database or its security rules.

let clock = Date.parse('2026-10-14T09:00:00Z')
const now = () => new Date((clock += 1000)).toISOString()

export class FakeData implements DataServices {
  contextRows: Context[] = []
  taskRows: Task[] = []
  /** When set, the next write fails with this error (then clears). */
  failNextWrite: DataError | null = null

  private takeFailure() {
    const failure = this.failNextWrite
    this.failNextWrite = null
    if (failure) throw failure
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
    list: async ({ includeArchived = false } = {}) =>
      this.contextRows.filter((context) => includeArchived || !context.archivedAt).map((context) => ({ ...context })),
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
    list: async (status: TaskStatus) =>
      this.taskRows
        .filter((task) => task.status === status && !task.archivedAt)
        .sort((a, b) =>
          status === 'done' ? (b.completedAt ?? '').localeCompare(a.completedAt ?? '') : a.createdAt.localeCompare(b.createdAt),
        )
        .map((task) => ({ ...task })),
    create: async ({ contextId, title }) => {
      this.takeFailure()
      this.findContext(contextId)
      return { ...this.addTask(contextId, title.trim()) }
    },
    setDone: async (id, done) => {
      this.takeFailure()
      const task = this.taskRows.find((entry) => entry.id === id)
      if (!task) throw new DataError('missing', 'Could not change the task: it no longer exists.')
      task.status = done ? 'done' : 'open'
      task.completedAt = done ? now() : null
      task.updatedAt = now()
      return { ...task }
    },
  }
}
