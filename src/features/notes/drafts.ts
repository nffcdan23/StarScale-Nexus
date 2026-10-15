import { useSyncExternalStore } from 'react'
import { limits, type NoteDoc } from '../../data/types'

// Unsaved note changes kept in this browser (localStorage) until the
// database confirms a save. Approved in Phase 3c:
//   - only for the signed-in owner, filed under their account id and the
//     note's stable id (a new note's id is made on the device);
//   - a write counts only once it has been read back unchanged;
//   - a draft is removed only after the database confirms the save, or when
//     the owner chooses to discard it;
//   - a version that conflicts with the database ("held") is never applied
//     automatically: the owner resolves it (Phase 3c-3).
// Drafts are plain text in this browser profile, like the signed-in session
// itself. They are never sent anywhere except as normal saves.

/** One note's unsaved changes. */
export interface NoteDraft {
  ownerId: string
  noteId: string
  /** True for a note that has never been saved to the database. */
  isNew: boolean
  /** The database revision these changes were made on (0 for a new note). */
  baseRevision: number
  title: string
  contextId: string | null
  content: NoteDoc
  /** When the latest change was made. */
  changedAt: string
  /** A version that conflicts with the database: kept until the owner resolves it. */
  held: boolean
  /**
   * For held versions: this record's own id. It is also the id "Keep both"
   * gives the copy, so retrying can never create a second copy. Missing only
   * on held versions written before Phase 3c-3.
   */
  heldId?: string
  /** The editing session that wrote it; a session removes only its own drafts. */
  writer?: string
}

const PREFIX = 'nexus.noteDraft.v1:'

/** Storage key: owner, note, and for held versions ":held:<heldId>" (":held" before Phase 3c-3). */
function keyFor(draft: Pick<NoteDraft, 'ownerId' | 'noteId' | 'held' | 'heldId'>) {
  const suffix = draft.held ? (draft.heldId ? `:held:${draft.heldId}` : ':held') : ''
  return `${PREFIX}${draft.ownerId}:${draft.noteId}${suffix}`
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Reads a stored draft, or null if it is damaged or does not match where it is filed. */
function parse(raw: string | null, expected: Pick<NoteDraft, 'ownerId' | 'noteId' | 'held' | 'heldId'>): NoteDraft | null {
  if (!raw) return null
  try {
    const draft = JSON.parse(raw) as Partial<NoteDraft>
    const valid =
      draft.ownerId === expected.ownerId &&
      draft.noteId === expected.noteId &&
      draft.held === expected.held &&
      (draft.heldId ?? undefined) === expected.heldId &&
      (draft.writer === undefined || typeof draft.writer === 'string') &&
      typeof draft.isNew === 'boolean' &&
      Number.isInteger(draft.baseRevision) &&
      (draft.baseRevision ?? -1) >= 0 &&
      typeof draft.title === 'string' &&
      draft.title.length <= limits.noteTitle &&
      (draft.contextId === null || typeof draft.contextId === 'string') &&
      typeof draft.changedAt === 'string' &&
      typeof draft.content === 'object' &&
      draft.content !== null &&
      (draft.content as { type?: unknown }).type === 'doc'
    return valid ? (draft as NoteDraft) : null
  } catch {
    return null
  }
}

/** Works out what a stored key refers to, for this owner. */
function describeKey(key: string, ownerId: string) {
  const prefix = `${PREFIX}${ownerId}:`
  if (!key.startsWith(prefix)) return null
  const [noteId, marker, heldId] = key.slice(prefix.length).split(':')
  if (!noteId || (marker !== undefined && marker !== 'held')) return null
  return { ownerId, noteId, held: marker === 'held', heldId: heldId || undefined }
}

// Screens showing drafts redraw when they change, in this tab or another.
let version = 0
const listeners = new Set<() => void>()
function changed() {
  version += 1
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) changed()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

// After the owner chooses to delete their drafts at sign-out, nothing may
// write them back while the screen closes. Lifted when Notes opens again.
const stopped = new Set<string>()

const sameDraft = (a: NoteDraft, b: NoteDraft) => a.changedAt === b.changedAt && a.writer === b.writer

export const drafts = {
  /** Whether drafts can be kept in this browser at all (not in some private windows, or when full). */
  available(): boolean {
    const store = storage()
    if (!store) return false
    try {
      const probe = `${PREFIX}probe`
      store.setItem(probe, '1')
      const ok = store.getItem(probe) === '1'
      store.removeItem(probe)
      return ok
    } catch {
      return false
    }
  },

  /** Stores a draft. True only if it was written and read back unchanged. */
  write(draft: NoteDraft): boolean {
    const store = storage()
    if (!store || stopped.has(draft.ownerId) || (draft.held && !draft.heldId)) return false
    const key = keyFor(draft)
    const text = JSON.stringify(draft)
    try {
      store.setItem(key, text)
      const ok = store.getItem(key) === text
      changed()
      return ok
    } catch {
      return false
    }
  },

  /** The note's current (not held) draft. */
  read(ownerId: string, noteId: string): NoteDraft | null {
    try {
      const expected = { ownerId, noteId, held: false }
      return parse(storage()?.getItem(keyFor(expected)) ?? null, expected)
    } catch {
      return null
    }
  },

  /** The note's held versions, oldest first. */
  readHeld(ownerId: string, noteId: string): NoteDraft[] {
    return this.list(ownerId)
      .filter((draft) => draft.held && draft.noteId === noteId)
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt))
  },

  /** This owner's drafts, held ones included, most recent change first. */
  list(ownerId: string): NoteDraft[] {
    const store = storage()
    if (!store) return []
    const found: NoteDraft[] = []
    try {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index)
        const where = key ? describeKey(key, ownerId) : null
        if (!key || !where) continue
        const draft = parse(store.getItem(key), where)
        if (draft) found.push(draft)
      }
    } catch {
      return found
    }
    return found.sort((a, b) => b.changedAt.localeCompare(a.changedAt))
  },

  /**
   * Removes the note's current draft: only after the database confirms a
   * save, or by the owner's choice. Given a writer, it removes the draft only
   * if that session wrote it, so one tab never deletes another tab's work.
   */
  remove(ownerId: string, noteId: string, writer?: string) {
    const stored = this.read(ownerId, noteId)
    if (writer !== undefined && stored && stored.writer !== undefined && stored.writer !== writer) return
    try {
      storage()?.removeItem(keyFor({ ownerId, noteId, held: false }))
    } catch {
      // Nothing more can be done; the draft stays.
    }
    changed()
  },

  /** Removes one held version: only once it is resolved (or deleted by the owner's choice). */
  removeHeld(draft: NoteDraft) {
    try {
      storage()?.removeItem(keyFor(draft))
    } catch {
      // Nothing more can be done; it stays.
    }
    changed()
  },

  /**
   * Keeps a version aside as held, under its own id. The current draft it
   * came from is removed only once the held copy is safely written, and only
   * if no newer draft has replaced it meanwhile. Returns the held version,
   * or null if it could not be written (the original then stays).
   */
  hold(draft: NoteDraft, heldId: string = draft.heldId ?? crypto.randomUUID()): NoteDraft | null {
    const held: NoteDraft = { ...draft, held: true, heldId }
    if (!this.write(held)) return null
    if (!draft.held) {
      const current = this.read(draft.ownerId, draft.noteId)
      if (current && sameDraft(current, draft)) this.remove(draft.ownerId, draft.noteId)
    } else if (!draft.heldId) {
      // A held version from before Phase 3c-3: now filed under its own id.
      this.removeHeld(draft)
    }
    return held
  },

  /** Deletes all of this owner's drafts and stops new ones being written (sign-out choice). */
  deleteAllAndStop(ownerId: string) {
    stopped.add(ownerId)
    for (const draft of this.list(ownerId)) {
      if (draft.held) this.removeHeld(draft)
      else this.remove(ownerId, draft.noteId)
    }
  },

  /** Lets drafts be written again for this owner (Notes opened after signing in). */
  allow(ownerId: string) {
    stopped.delete(ownerId)
  },
}

// The list is rebuilt only when drafts change, so screens get the same list until then.
const listCache = new Map<string, { version: number; list: NoteDraft[] }>()
const noDrafts: NoteDraft[] = []

function cachedList(ownerId: string | null): NoteDraft[] {
  if (!ownerId) return noDrafts
  const cached = listCache.get(ownerId)
  if (cached?.version === version) return cached.list
  const list = drafts.list(ownerId)
  listCache.set(ownerId, { version, list })
  return list
}

/** This owner's drafts, kept up to date. */
export function useNoteDrafts(ownerId: string | null): NoteDraft[] {
  return useSyncExternalStore(subscribe, () => cachedList(ownerId))
}

// Notes that are open register here, so signing out can save them first.
const openNotes = new Set<() => Promise<void>>()

export function registerOpenNote(saveBeforeLeaving: () => Promise<void>) {
  openNotes.add(saveBeforeLeaving)
  return () => {
    openNotes.delete(saveBeforeLeaving)
  }
}

/** Saves every open note (draft first, then the database), waiting at most a few seconds. */
export async function saveOpenNotes(timeout = 5_000) {
  const work = Promise.allSettled([...openNotes].map((save) => save()))
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, timeout))])
}
