import { useSyncExternalStore } from 'react'
import { limits, type NoteDoc } from '../../data/types'

// Unsaved note changes kept in this browser (localStorage) until the
// database confirms a save. Approved in Phase 3c:
//   - only for the signed-in owner, filed under their account id and the
//     note's stable id (a new note's id is made on the device);
//   - a write counts only once it has been read back unchanged;
//   - a draft is removed only after the database confirms the save, or when
//     the owner chooses to discard it;
//   - a draft based on an older revision than the database holds is kept
//     aside ("held"), never applied automatically.
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
  /** Kept aside because the database has a newer version; never applied automatically. */
  held: boolean
}

const PREFIX = 'nexus.noteDraft.v1:'
const keyFor = (ownerId: string, noteId: string, held: boolean) => `${PREFIX}${ownerId}:${noteId}${held ? ':held' : ''}`

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Reads a stored draft, or null if it is missing, damaged or not this owner's. */
function parse(raw: string | null, ownerId: string, noteId: string, held: boolean): NoteDraft | null {
  if (!raw) return null
  try {
    const draft = JSON.parse(raw) as Partial<NoteDraft>
    const valid =
      draft.ownerId === ownerId &&
      draft.noteId === noteId &&
      draft.held === held &&
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
    if (!store || stopped.has(draft.ownerId)) return false
    const key = keyFor(draft.ownerId, draft.noteId, draft.held)
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

  read(ownerId: string, noteId: string, held = false): NoteDraft | null {
    const store = storage()
    if (!store) return null
    try {
      return parse(store.getItem(keyFor(ownerId, noteId, held)), ownerId, noteId, held)
    } catch {
      return null
    }
  },

  /** This owner's drafts, held ones included, most recent change first. */
  list(ownerId: string): NoteDraft[] {
    const store = storage()
    if (!store) return []
    const found: NoteDraft[] = []
    try {
      const prefix = `${PREFIX}${ownerId}:`
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index)
        if (!key?.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        const held = rest.endsWith(':held')
        const noteId = held ? rest.slice(0, -':held'.length) : rest
        const draft = parse(store.getItem(key), ownerId, noteId, held)
        if (draft) found.push(draft)
      }
    } catch {
      return found
    }
    return found.sort((a, b) => b.changedAt.localeCompare(a.changedAt))
  },

  /** Removes a draft: only after a confirmed save, or by the owner's choice. */
  remove(ownerId: string, noteId: string, held = false) {
    try {
      storage()?.removeItem(keyFor(ownerId, noteId, held))
    } catch {
      // Nothing more can be done; the draft stays.
    }
    changed()
  },

  /**
   * Keeps a draft aside because the database has a newer version. The
   * original is removed only once the held copy is safely written.
   */
  hold(draft: NoteDraft): boolean {
    const ok = this.write({ ...draft, held: true })
    if (ok) this.remove(draft.ownerId, draft.noteId)
    return ok
  },

  /** Deletes all of this owner's drafts and stops new ones being written (sign-out choice). */
  deleteAllAndStop(ownerId: string) {
    stopped.add(ownerId)
    for (const draft of this.list(ownerId)) this.remove(ownerId, draft.noteId, draft.held)
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
