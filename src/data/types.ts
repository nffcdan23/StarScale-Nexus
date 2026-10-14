// The shapes the app works with. Written by hand to match
// supabase/migrations; the integration tests on the Windows PC confirm that
// the real database returns exactly these.
//
// Deadlines are not here yet: they wait for the approved due-date migration
// and the task editor (Phase 2c-2b).

export type Priority = 'low' | 'medium' | 'high'
export type TaskStatus = 'open' | 'done'

/**
 * An area of life (for example Personal or StarScale). Created and named by
 * the owner, and meant to be shared by every Nexus feature, not only tasks.
 */
export interface Context {
  id: string
  name: string
  /** The TV shows tasks only from contexts where this is on. */
  showOnTv: boolean
  archivedAt: string | null
  createdAt: string
}

export interface Task {
  id: string
  contextId: string
  title: string
  notes: string | null
  status: TaskStatus
  priority: Priority
  hideFromTv: boolean
  completedAt: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface NewTask {
  contextId: string
  title: string
}

/** Database limits, repeated here so forms can stop a value before sending it. */
export const limits = {
  contextName: 60,
  taskTitle: 200,
} as const

/** A failure whose message is fit to show to the owner. */
export class DataError extends Error {
  readonly kind: 'refused' | 'invalid' | 'missing' | 'offline' | 'unknown'

  constructor(kind: DataError['kind'], message: string) {
    super(message)
    this.name = 'DataError'
    this.kind = kind
  }
}

export interface ContextsService {
  /** Active contexts, oldest first; archived ones too when asked. */
  list(options?: { includeArchived?: boolean }): Promise<Context[]>
  create(name: string): Promise<Context>
  rename(id: string, name: string): Promise<Context>
  setShowOnTv(id: string, showOnTv: boolean): Promise<Context>
  setArchived(id: string, archived: boolean): Promise<Context>
}

export interface TasksService {
  /** Tasks with the given status that are not archived. */
  list(status: TaskStatus): Promise<Task[]>
  create(task: NewTask): Promise<Task>
  setDone(id: string, done: boolean): Promise<Task>
}

export interface DataServices {
  contexts: ContextsService
  tasks: TasksService
}
