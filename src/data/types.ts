// The shapes the app works with. Written by hand to match
// supabase/migrations; the integration tests on the Windows PC confirm that
// the real database returns exactly these.

export type Priority = 'low' | 'medium' | 'high'
export type TaskStatus = 'open' | 'done'

/** Which tasks a list shows: open, completed, or archived (whatever their status). */
export type TaskView = 'open' | 'done' | 'archived'

/**
 * A deadline is either a calendar day with no time ("due on Friday") or an
 * exact moment ("Friday at 09:00"), never both. The database enforces this.
 */
export type Deadline = { kind: 'date'; date: string } | { kind: 'time'; at: string } | null

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

/**
 * The single structure that organises notes, tasks and (later) files. Owned
 * by the owner, optionally within one of their contexts, archived rather
 * than deleted. A name is unique among the owner's active projects.
 */
export interface Project {
  id: string
  name: string
  contextId: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface NewProject {
  name: string
  contextId?: string | null
}

/** A project's notes and tasks: the same records the Notes and Tasks pages show, never copies. */
export interface ProjectContents {
  /** Active notes, pinned first then most recently edited. */
  notes: NoteSummary[]
  /** Tasks that are not archived, open first (oldest first), then completed (newest first). */
  tasks: Task[]
}

export interface Task {
  id: string
  contextId: string
  /** Null means the task is in no project. */
  projectId: string | null
  title: string
  notes: string | null
  status: TaskStatus
  priority: Priority
  hideFromTv: boolean
  deadline: Deadline
  completedAt: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface NewTask {
  contextId: string
  title: string
  projectId?: string | null
}

/** The details the owner can edit. Anything left out is unchanged. */
export interface TaskChanges {
  title?: string
  notes?: string | null
  priority?: Priority
  contextId?: string
  hideFromTv?: boolean
  deadline?: Deadline
  /** Null takes the task out of its project. */
  projectId?: string | null
}

/**
 * One task as the TV summary returns it: only these fields ever leave the
 * database for the TV. The database decides which tasks are included.
 */
export interface TvTask {
  title: string
  context: string
  priority: Priority
  deadline: Deadline
}

export interface TvSummary {
  /** When the database produced this summary. */
  generatedAt: string
  /** Earliest deadline day first (London time), then priority. At most 50. */
  tasks: TvTask[]
}

/**
 * A note's formatted content, as the editor saves it: a tree of nodes whose
 * root is a document. Stored as JSON, never as HTML. The database checks it
 * and derives the searchable plain text from it.
 */
export interface NoteDoc {
  type: 'doc'
  content?: unknown[]
  [key: string]: unknown
}

/** What a note list shows, without loading the whole note. */
export interface NoteSummary {
  id: string
  title: string
  /** Null means no context. */
  contextId: string | null
  /** Null means the note is in the Inbox. Moving a note is not an edit: it never changes the revision. */
  projectId: string | null
  pinned: boolean
  /** The first 200 characters of the note's plain text. */
  preview: string
  /** Raised by the database on every edit to the title, text or context. */
  revision: number
  createdAt: string
  /** The last edit to the title, text or context (not pinning or archiving). */
  updatedAt: string
  archivedAt: string | null
}

export interface Note extends NoteSummary {
  content: NoteDoc
  /** Plain text derived by the database from content. Read-only. */
  text: string
}

/** A note's revision and status without its content: enough to notice a change made elsewhere. */
export interface NoteVersion {
  id: string
  revision: number
  updatedAt: string
  pinned: boolean
  archivedAt: string | null
}

/** The parts of a note the owner edits. Anything left out is unchanged. */
export interface NoteChanges {
  title?: string
  content?: NoteDoc
  contextId?: string | null
}

/** One stretch of a search snippet; matched words have match set. */
export interface SnippetPart {
  text: string
  match: boolean
}

export interface NoteSearchResult {
  id: string
  title: string
  contextId: string | null
  projectId: string | null
  pinned: boolean
  archivedAt: string | null
  updatedAt: string
  snippet: SnippetPart[]
}

/** Database limits, repeated here so forms can stop a value before sending it. */
export const limits = {
  contextName: 60,
  projectName: 80,
  taskTitle: 200,
  taskNotes: 10000,
  noteTitle: 200,
  /** Size of the stored document, in bytes of JSON. */
  noteContentBytes: 1_000_000,
  noteSearch: 200,
} as const

/** A failure whose message is fit to show to the owner. */
export class DataError extends Error {
  /** conflict: the record changed elsewhere since it was loaded, so nothing was saved. */
  readonly kind: 'refused' | 'invalid' | 'missing' | 'offline' | 'conflict' | 'unknown'

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

export interface ProjectsService {
  /** Active projects by name; archived ones too when asked. */
  list(options?: { includeArchived?: boolean }): Promise<Project[]>
  get(id: string): Promise<Project>
  /** Pass the same id when retrying, so a lost reply never creates a second project. */
  create(project: NewProject, options?: { id?: string }): Promise<Project>
  rename(id: string, name: string): Promise<Project>
  setContext(id: string, contextId: string | null): Promise<Project>
  /** Archiving keeps the project's notes and tasks linked; restoring needs its name to be free. */
  setArchived(id: string, archived: boolean): Promise<Project>
  /** The project's notes and tasks. */
  contents(id: string): Promise<ProjectContents>
}

export interface TasksService {
  /** Open or completed tasks that are not archived, or archived tasks. */
  list(view: TaskView): Promise<Task[]>
  /** Tasks completed at or after this moment that are still completed and not archived, newest first. */
  completedSince(since: Date): Promise<Task[]>
  create(task: NewTask): Promise<Task>
  update(id: string, changes: TaskChanges): Promise<Task>
  setDone(id: string, done: boolean): Promise<Task>
  setArchived(id: string, archived: boolean): Promise<Task>
  /** Puts the task in a project, or (null) in none. */
  setProject(id: string, projectId: string | null): Promise<Task>
}

/** The redacted summary the TV shows. The owner, with an authenticator code, may call it too. */
export interface SummaryService {
  get(): Promise<TvSummary>
}

export interface NotesService {
  /**
   * Active notes, pinned first then most recently edited; or archived notes,
   * most recently archived first. projectId keeps to one project, or with
   * null to the Inbox (notes in no project); left out, every note.
   */
  list(options?: { archived?: boolean; projectId?: string | null }): Promise<NoteSummary[]>
  get(id: string): Promise<Note>
  /** Reads only the revision and status, never the content. */
  peek(id: string): Promise<NoteVersion>
  /**
   * Creates a note. Pass the same id when retrying, so a request that reached
   * the database but whose reply was lost never creates a second copy.
   */
  create(changes?: NoteChanges, options?: { id?: string; projectId?: string | null }): Promise<Note>
  /**
   * Saves edits made to the given revision. If the note has changed since
   * (another device saved first), nothing is saved and a DataError with kind
   * "conflict" is thrown.
   */
  save(id: string, changes: NoteChanges, baseRevision: number): Promise<Note>
  setPinned(id: string, pinned: boolean): Promise<NoteSummary>
  setArchived(id: string, archived: boolean): Promise<NoteSummary>
  /** Moves the note to a project, or (null) to the Inbox. Not an edit: the revision is unchanged. */
  setProject(id: string, projectId: string | null): Promise<NoteSummary>
  /**
   * Title and text search, best match first, at most 50 results. projectId
   * keeps to one project, or with null to the Inbox; pinnedOnly to pinned notes.
   */
  search(
    text: string,
    options?: { includeArchived?: boolean; contextId?: string; projectId?: string | null; pinnedOnly?: boolean },
  ): Promise<NoteSearchResult[]>
}

export interface DataServices {
  contexts: ContextsService
  projects: ProjectsService
  tasks: TasksService
  summary: SummaryService
  notes: NotesService
}
