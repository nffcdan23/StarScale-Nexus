import type { JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorContent, useEditor } from '@tiptap/react'
import { Archive, ArchiveRestore, ArrowLeft, Pin } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../app/auth/authContext'
import { useData } from '../../app/data/dataContext'
import form from '../../components/Form/Form.module.css'
import { DataError, limits, type Context, type Note, type NoteChanges, type NoteDoc } from '../../data/types'
import { cx } from '../../lib/cx'
import { londonClock } from '../../lib/dashboard'
import { ConflictResolver } from './ConflictResolver'
import { copyTitle, sameAsDatabase } from './conflicts'
import { drafts, registerOpenNote, type NoteDraft } from './drafts'
import { createNoteExtensions, editorOptions } from './editor/extensions'
import { FormatToolbar } from './editor/FormatToolbar'
import { editedLabel } from './noteTime'
import { autosaveTiming, useAutosave, type SaveOutcome } from './useAutosave'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'
import styles from './NoteEditor.module.css'

const emptyDoc: NoteDoc = { type: 'doc', content: [] }

/** Wait after an edit before keeping a copy on this computer (also kept at once on leaving or closing). */
const DRAFT_DELAY = 300

const asDataError = (error: unknown) => (error instanceof DataError ? error : new DataError('unknown', String(error)))

interface NoteEditorPaneProps {
  /** Null for a new note that has not been saved yet. */
  noteId: string | null
  /** Identifies this editing session; unchanged when a new note gets its address. */
  editorSession: string
  contexts: Context[]
  /** Called after anything the notes list shows has changed. */
  onChanged: () => void
}

/** What the editor opens with, decided once when the note is loaded. */
interface Opening {
  note: Note | null
  /** The id a new note will be created with. */
  newNoteId: string
  /** Unsaved changes from this computer, safe to apply on top of note. */
  restored: NoteDraft | null
  /** Versions from this computer that conflict with the database, oldest first, to resolve. */
  held: NoteDraft[]
}

/**
 * Loads one note (or starts a new one), checks this computer for unsaved
 * changes to it, and shows it in the editor. Loaded once: when a new note's
 * first save gives it an address, the same editor carries on.
 */
export function NoteEditorPane({ noteId, editorSession, contexts, onChanged }: NoteEditorPaneProps) {
  const { notes } = useData()
  const { state, actions } = useAuth()
  const ownerId = state.phase === 'ready' && state.snapshot.status === 'owner' ? state.snapshot.userId : null
  const [initialId] = useState(noteId)
  const [opening, setOpening] = useState<Opening | null>(() =>
    initialId ? null : { note: null, newNoteId: crypto.randomUUID(), restored: null, held: [] },
  )
  const [failure, setFailure] = useState<DataError | null>(null)

  useEffect(() => {
    if (!initialId) return
    let active = true
    const draft = ownerId ? drafts.read(ownerId, initialId) : null
    notes.get(initialId).then(
      (note) => {
        if (!active) return
        const held: NoteDraft[] = []
        /** Keeps a version to resolve, filed under its own id (only in memory if it cannot be stored). */
        const toResolve = (version: NoteDraft) => {
          // A version that already says exactly what the database holds needs no decision.
          if (sameAsDatabase(version, note)) {
            if (version.held) drafts.removeHeld(version)
            else drafts.remove(version.ownerId, version.noteId)
            return
          }
          const kept = version.held && version.heldId ? version : drafts.hold(version)
          held.push(kept ?? { ...version, held: true, heldId: version.heldId ?? crypto.randomUUID() })
        }

        const heldBefore = ownerId ? drafts.readHeld(ownerId, initialId) : []
        for (const version of heldBefore) toResolve(version)
        let restored: NoteDraft | null = null
        if (draft) {
          // Safe to apply only if made on the version the database still has
          // (or, for a note this computer created, on that first version), and
          // only when nothing else is waiting to be resolved first.
          const sameVersion = draft.baseRevision === note.revision || (draft.isNew && note.revision === 1)
          if (sameVersion && !note.archivedAt && held.length === 0) restored = draft
          else toResolve(draft)
        }
        setOpening({ note, newNoteId: initialId, restored, held })
      },
      (error: unknown) => {
        if (!active) return
        const problem = asDataError(error)
        // A note created on this computer that never reached the database.
        if (problem.kind === 'missing' && draft?.isNew) {
          setOpening({ note: null, newNoteId: initialId, restored: draft, held: [] })
          return
        }
        if (problem.kind === 'refused') void actions.recheck()
        setFailure(problem)
      },
    )
    return () => {
      active = false
    }
  }, [initialId, notes, actions, ownerId])

  if (failure) {
    return (
      <div className={styles.message}>
        <p className={form.error} role="alert">
          {failure.kind === 'missing' ? 'This note no longer exists.' : failure.message}
        </p>
        <Link className={styles.back} to="/notes">
          <ArrowLeft className={styles.smallIcon} aria-hidden="true" />
          All notes
        </Link>
      </div>
    )
  }
  if (!opening) return <p className={styles.loading}>Opening note…</p>

  return (
    <NoteEditor
      opening={opening}
      ownerId={ownerId}
      editorSession={editorSession}
      contexts={contexts}
      onChanged={onChanged}
    />
  )
}

interface NoteEditorProps {
  opening: Opening
  ownerId: string | null
  editorSession: string
  contexts: Context[]
  onChanged: () => void
}

/** What the database holds for this note, as last loaded or saved. */
interface Saved {
  id: string | null
  title: string
  contextId: string | null
  revision: number
  pinned: boolean
  archivedAt: string | null
  updatedAt: string | null
}

const savedFrom = (note: Note | null): Saved => ({
  id: note?.id ?? null,
  title: note?.title ?? '',
  contextId: note?.contextId ?? null,
  revision: note?.revision ?? 0,
  pinned: note?.pinned ?? false,
  archivedAt: note?.archivedAt ?? null,
  updatedAt: note?.updatedAt ?? null,
})

/** The latest edits and what is saved, always current (saves read these, never an older copy). */
interface Live {
  saved: Saved
  title: string
  contextId: string | null
  /** Raised by every change to the text. */
  contentVersion: number
  /** The text version the last successful save sent. */
  savedContentVersion: number
  /** Raised by every edit of any kind. */
  edits: number
  /** The edit count last kept on this computer and read back (-1: none). */
  draftedEdits: number
  /** Two versions are waiting for the owner's decision: saving is paused. */
  conflict: boolean
  /** Whether every version waiting for a decision is safely kept on this computer. */
  conflictKept: boolean
}

const unsaved = (live: Pick<Live, 'saved' | 'title' | 'contextId' | 'contentVersion' | 'savedContentVersion'>) =>
  live.saved.id === null
    ? live.title.trim() !== '' || live.contentVersion !== live.savedContentVersion
    : live.title !== live.saved.title ||
      live.contextId !== live.saved.contextId ||
      live.contentVersion !== live.savedContentVersion

/** What the save status line says. */
type Phase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'refreshed'; at: Date }
  | { kind: 'failed'; reason: DataError['kind']; message: string }

/** The conflict screen's state: versions to resolve, and the database's latest version. */
interface Resolution {
  queue: NoteDraft[]
  latest: Note | null
  loadError: string | null
  error: string | null
  notice: string | null
  busy: boolean
}

function NoteEditor({ opening, ownerId, editorSession, contexts, onChanged }: NoteEditorProps) {
  const { notes } = useData()
  const { actions } = useAuth()
  const navigate = useNavigate()
  const titleId = useId()
  const { note, restored, newNoteId } = opening
  // This editing session: it removes only the drafts it wrote itself.
  const [writer] = useState(() => crypto.randomUUID())
  // Whether this browser can keep copies of unsaved changes at all.
  const [storageOk] = useState(() => Boolean(ownerId) && drafts.available())

  // view draws the screen; live holds the same values for saving, updated
  // the moment anything changes. sync() copies live into view. Restored
  // changes start as one unsaved edit, already kept on this computer.
  const [view, setView] = useState<Live>(() => ({
    saved: savedFrom(note),
    title: restored?.title ?? note?.title ?? '',
    contextId: restored ? restored.contextId : (note?.contextId ?? null),
    contentVersion: restored ? 1 : 0,
    savedContentVersion: 0,
    edits: restored ? 1 : 0,
    draftedEdits: restored ? 1 : -1,
    conflict: opening.held.length > 0,
    conflictKept: opening.held.every((version) => drafts.readHeld(version.ownerId, version.noteId).some((stored) => stored.heldId === version.heldId)),
  }))
  const live = useRef<Live>({ ...view })
  const sync = useCallback(() => setView({ ...live.current }), [])

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [leaveFailed, setLeaveFailed] = useState(false)
  const [restoredNotice, setRestoredNotice] = useState<NoteDraft | null>(restored)
  const [keptCopy, setKeptCopy] = useState<{ id: string; title: string } | null>(null)
  const [resolution, setResolution] = useState<Resolution>(() => ({
    queue: opening.held,
    latest: opening.held.length > 0 ? note : null,
    loadError: null,
    error: null,
    notice: null,
    busy: false,
  }))

  const { saved, title, contextId } = view
  const archived = Boolean(saved.archivedAt)
  const isNew = saved.id === null
  const dirty = unsaved(view)
  const keptHere = view.conflict ? view.conflictKept : dirty && view.draftedEdits === view.edits

  // The latest document, kept so a copy can still be made while the editor closes.
  const latestDoc = useRef<ProseMirrorNode | null>(null)
  const editor = useEditor({
    ...editorOptions,
    extensions: createNoteExtensions(),
    content: (restored?.content ?? note?.content ?? emptyDoc) as JSONContent,
    editable: !archived && opening.held.length === 0,
    editorProps: { attributes: { 'aria-label': 'Note text', class: styles.prose } },
    onCreate: ({ editor: created }) => {
      latestDoc.current = created.state.doc
    },
    onUpdate: ({ editor: updated }) => {
      latestDoc.current = updated.state.doc
      live.current.contentVersion += 1
      live.current.edits += 1
      sync()
    },
  })

  useEffect(() => {
    // Without false, switching would count as an edit. No editing while a conflict waits.
    editor.setEditable(!archived && !view.conflict, false)
  }, [editor, archived, view.conflict])

  // Restored changes now belong to this session, so its confirmed save can remove them.
  useEffect(() => {
    if (restored && ownerId) drafts.write({ ...restored, writer })
  }, [restored, ownerId, writer])

  const editTitle = (value: string) => {
    live.current.title = value
    live.current.edits += 1
    sync()
  }
  const editContext = (value: string | null) => {
    live.current.contextId = value
    live.current.edits += 1
    sync()
  }

  /**
   * Keeps the unsaved changes on this computer. True if they are safely
   * kept (or nothing needs keeping); false if they could not be.
   */
  const keepDraft = useCallback((): boolean => {
    const current = live.current
    // During a conflict your version is already kept aside, and the editor is not editable.
    if (current.conflict) return current.conflictKept
    if (!unsaved(current)) return true
    if (current.draftedEdits === current.edits) return true
    if (!ownerId || !latestDoc.current) return false
    const ok = drafts.write({
      ownerId,
      noteId: current.saved.id ?? newNoteId,
      isNew: current.saved.id === null,
      baseRevision: current.saved.revision,
      title: current.title,
      contextId: current.contextId,
      content: latestDoc.current.toJSON() as NoteDoc,
      changedAt: new Date().toISOString(),
      held: false,
      writer,
    })
    current.draftedEdits = ok ? current.edits : -1
    sync()
    return ok
  }, [ownerId, newNoteId, writer, sync])

  // A copy shortly after each edit, and at once when the tab is hidden or the page closes.
  useEffect(() => {
    if (view.edits === 0) return
    const timer = setTimeout(() => keepDraft(), DRAFT_DELAY)
    return () => clearTimeout(timer)
  }, [view.edits, keepDraft])

  const keepDraftNow = useRef(keepDraft)
  useEffect(() => {
    keepDraftNow.current = keepDraft
  }, [keepDraft])
  useEffect(() => {
    const keep = () => keepDraftNow.current()
    const onHidden = () => {
      if (document.visibilityState === 'hidden') keep()
    }
    window.addEventListener('pagehide', keep)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', keep)
      document.removeEventListener('visibilitychange', onHidden)
      // Closing the editor (another page, signing out, an ended session): keep what is unsaved.
      keep()
    }
  }, [])

  const { blocker, allowNextNavigation } = useUnsavedChangesGuard(dirty, keepDraft)

  /** Shows a version from the database in place of what is on screen. */
  const showVersion = useCallback(
    (fresh: Note) => {
      editor.commands.setContent(fresh.content as JSONContent, { emitUpdate: false })
      latestDoc.current = editor.state.doc
      live.current = {
        ...live.current,
        saved: savedFrom(fresh),
        title: fresh.title,
        contextId: fresh.contextId,
        savedContentVersion: live.current.contentVersion,
        draftedEdits: -1,
      }
      sync()
    },
    [editor, sync],
  )

  /** Fetches the database's latest version for the conflict screen. */
  const loadLatest = useCallback(
    async (id: string): Promise<Note | null> => {
      setResolution((current) => ({ ...current, loadError: null }))
      try {
        const fresh = await notes.get(id)
        setResolution((current) => ({ ...current, latest: fresh }))
        return fresh
      } catch (error) {
        const failure = asDataError(error)
        if (failure.kind === 'refused') void actions.recheck()
        setResolution((current) => ({ ...current, loadError: `Could not load the latest version. ${failure.message}` }))
        return null
      }
    },
    [notes, actions],
  )

  /**
   * One version is settled: its copy on this computer goes, the editor shows
   * the version that now stands, and the next waiting version (if any) is shown.
   */
  const settle = useCallback(
    (version: NoteDraft, standing: Note) => {
      drafts.removeHeld(version)
      showVersion(standing)
      setResolution((current) => {
        const queue = current.queue.filter((waiting) => waiting.heldId !== version.heldId)
        live.current.conflict = queue.length > 0
        sync()
        return { ...current, queue, latest: standing, error: null, notice: null, busy: false }
      })
      setPhase({ kind: 'idle' })
      onChanged()
    },
    [showVersion, sync, onChanged],
  )

  /**
   * A save was refused because the note changed elsewhere: put your version
   * aside on this computer (under its own id), stop saving, and show both.
   */
  const enterConflict = useCallback(async () => {
    const current = live.current
    if (!current.saved.id || !latestDoc.current) return
    const mine: NoteDraft = {
      ownerId: ownerId ?? '',
      noteId: current.saved.id,
      isNew: false,
      baseRevision: current.saved.revision,
      title: current.title,
      contextId: current.contextId,
      content: latestDoc.current.toJSON() as NoteDoc,
      changedAt: new Date().toISOString(),
      held: true,
      heldId: crypto.randomUUID(),
      writer,
    }
    const kept = Boolean(ownerId) && drafts.write(mine)
    // Your version now lives in the conflict record; this session's ordinary draft is no longer needed.
    if (kept && ownerId) drafts.remove(ownerId, mine.noteId, writer)
    current.conflict = true
    current.conflictKept = kept
    sync()
    setResolution((state) => ({ ...state, queue: [...state.queue, mine], error: null, notice: null }))
    const fresh = await loadLatest(mine.noteId)
    // Already identical (the same edit saved elsewhere): nothing to decide.
    if (fresh && sameAsDatabase(mine, fresh)) settle(mine, fresh)
  }, [ownerId, writer, sync, loadLatest, settle])

  /** One save attempt with the latest edits; autosave decides when. */
  const saveOnce = useCallback(async (): Promise<SaveOutcome> => {
    const current = live.current
    if (current.conflict || current.saved.archivedAt) return 'stop'
    if (!unsaved(current)) return 'saved'

    const base = current.saved
    const title = current.title
    const contextId = current.contextId
    const version = current.contentVersion
    const content = editor.getJSON() as NoteDoc
    setPhase({ kind: 'saving' })
    setProblem(null)
    try {
      let result: Note
      if (base.id === null) {
        result = await notes.create({ title, content, contextId }, { id: newNoteId })
      } else {
        const changes: NoteChanges = {}
        if (title !== base.title) changes.title = title
        if (contextId !== base.contextId) changes.contextId = contextId
        if (version !== current.savedContentVersion) changes.content = content
        // The revision this edit started from: a newer one in the database is never overwritten.
        result = await notes.save(base.id, changes, base.revision)
      }
      // Only what was sent counts as saved; anything typed since stays unsaved.
      live.current.saved = savedFrom(result)
      live.current.savedContentVersion = version
      if (!unsaved(live.current)) {
        // The database has confirmed everything: only now is this session's local copy removed.
        if (ownerId) drafts.remove(ownerId, result.id, writer)
      } else {
        // Still unsaved edits: keep them again, now based on the new revision.
        live.current.draftedEdits = -1
        keepDraft()
      }
      sync()
      setPhase({ kind: 'saved', at: new Date() })
      setRestoredNotice(null)
      onChanged()
      if (base.id === null) {
        // Give the new note its address without leaving this editor.
        allowNextNavigation()
        navigate(`/notes/${result.id}`, { replace: true, state: { editorSession } })
      }
      return 'saved'
    } catch (error) {
      const failure = asDataError(error)
      if (failure.kind === 'conflict') {
        // Stop saving this note until the owner decides; nothing is overwritten.
        setPhase({ kind: 'idle' })
        void enterConflict()
        return 'stop'
      }
      setPhase({ kind: 'failed', reason: failure.kind, message: failure.message })
      if (failure.kind === 'refused') void actions.recheck()
      if (failure.kind === 'invalid' || failure.kind === 'missing') {
        setProblem(failure.message)
        return 'stop'
      }
      return 'retry'
    }
  }, [editor, notes, newNoteId, ownerId, writer, keepDraft, sync, onChanged, allowNextNavigation, navigate, editorSession, actions, enterConflict])

  const { saveNow, retrying } = useAutosave({
    editCount: view.edits,
    isDirty: () => unsaved(live.current),
    save: saveOnce,
  })

  // Signing out saves open notes first (and keeps a copy of anything that cannot be saved).
  useEffect(
    () =>
      registerOpenNote(async () => {
        keepDraft()
        await saveNow()
      }),
    [keepDraft, saveNow],
  )

  // Ctrl+S or Cmd+S saves at once, wherever the cursor is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveNow])

  // Leaving with unsaved changes: save first, then go. If that fails but the
  // changes are kept on this computer, go anyway; ask only if they are not.
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let active = true
    void saveNow().then((outcome) => {
      if (!active) return
      if ((outcome === 'saved' && !unsaved(live.current)) || keepDraft()) blocker.proceed()
      else setLeaveFailed(true)
    })
    return () => {
      active = false
    }
  }, [blocker, saveNow, keepDraft])

  // Changes made on another device: while nothing here is unsaved, check the
  // note's revision every 30 seconds and whenever the tab is shown, and load
  // a newer version quietly. With unsaved changes the save itself detects
  // the conflict, so nothing is overwritten either way.
  const noteId = saved.id
  useEffect(() => {
    if (!noteId) return
    let active = true
    const check = async () => {
      if (document.visibilityState !== 'visible' || live.current.conflict || unsaved(live.current)) return
      try {
        const version = await notes.peek(noteId)
        const base = live.current.saved
        if (!active || version.revision < base.revision) return
        if (version.revision > base.revision) {
          const editsBefore = live.current.edits
          const fresh = await notes.get(noteId)
          // Typing started meanwhile: leave it; the next save will notice the conflict.
          if (!active || live.current.edits !== editsBefore || unsaved(live.current) || live.current.conflict) return
          showVersion(fresh)
          setPhase({ kind: 'refreshed', at: new Date(fresh.updatedAt) })
          onChanged()
        } else if (version.pinned !== base.pinned || version.archivedAt !== base.archivedAt) {
          live.current.saved = { ...base, pinned: version.pinned, archivedAt: version.archivedAt }
          sync()
          onChanged()
        }
      } catch {
        // A failed check changes nothing; the next check, or a save, reports any real problem.
      }
    }
    const timer = setInterval(() => void check(), autosaveTiming.peek)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [noteId, notes, showVersion, sync, onChanged])

  // ---- The three ways to settle a conflict ----------------------------------

  const resolving = resolution.queue[0] ?? null
  const failResolution = (error: unknown) => {
    const failure = asDataError(error)
    if (failure.kind === 'refused') void actions.recheck()
    setResolution((current) => ({ ...current, busy: false, error: `${failure.message} Your version is still kept; nothing was lost.` }))
  }
  const startResolving = () => setResolution((current) => ({ ...current, busy: true, error: null, notice: null }))

  /** Keep both: your version becomes a new note (its id fixed, so a retry never makes two); the latest stays. */
  const keepBoth = async () => {
    const version = resolving
    const latest = resolution.latest
    if (!version || !latest) return
    startResolving()
    try {
      const copy = await notes.create(
        { title: copyTitle(version), content: version.content, contextId: version.contextId },
        { id: version.heldId },
      )
      // Confirmed by the database: only now does the local copy go.
      setKeptCopy({ id: copy.id, title: copy.title })
      settle(version, latest)
    } catch (error) {
      failResolution(error)
    }
  }

  /** Use the latest version: discard yours (after confirmation) and show the newest saved version. */
  const chooseLatest = async () => {
    const version = resolving
    const shown = resolution.latest
    if (!version || !shown) return
    startResolving()
    let standing = shown
    try {
      standing = await notes.get(version.noteId)
    } catch {
      // Offline: the version already shown is the latest known; it is what the owner confirmed.
    }
    settle(version, standing)
  }

  /**
   * Use my version: check the database still holds the version shown, then
   * save yours over it, guarded by its revision. If it changed again, stop
   * and show the newer version instead.
   */
  const chooseMine = async () => {
    const version = resolving
    const shown = resolution.latest
    if (!version || !shown || shown.archivedAt) return
    startResolving()
    const changedAgain = async () => {
      const fresh = await loadLatest(version.noteId)
      setResolution((current) => ({
        ...current,
        busy: false,
        notice: fresh
          ? 'The note changed again on another device while you were deciding. This is now the latest version: please choose again.'
          : null,
      }))
    }
    try {
      const check = await notes.peek(version.noteId)
      if (check.revision !== shown.revision || check.archivedAt !== shown.archivedAt) {
        await changedAgain()
        return
      }
      const result = await notes.save(
        version.noteId,
        { title: version.title, content: version.content, contextId: version.contextId },
        shown.revision,
      )
      settle(version, result)
      setPhase({ kind: 'saved', at: new Date() })
    } catch (error) {
      if (asDataError(error).kind === 'conflict') await changedAgain()
      else failResolution(error)
    }
  }

  const runAction = async (work: () => Promise<Partial<Saved>>, after?: () => void) => {
    setBusy(true)
    setProblem(null)
    try {
      const changed = await work()
      live.current.saved = { ...live.current.saved, ...changed }
      sync()
      onChanged()
      after?.()
    } catch (error) {
      const failure = asDataError(error)
      if (failure.kind === 'refused') void actions.recheck()
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const togglePin = () => runAction(async () => ({ pinned: (await notes.setPinned(saved.id!, !saved.pinned)).pinned }))
  const archive = () =>
    runAction(
      async () => ({ archivedAt: (await notes.setArchived(saved.id!, true)).archivedAt }),
      () => navigate('/notes'),
    )
  const restore = () => runAction(async () => ({ archivedAt: (await notes.setArchived(saved.id!, false)).archivedAt }))

  /** The owner chose to throw away the changes restored from this computer. */
  const discardRestored = () => {
    if (ownerId) drafts.remove(ownerId, saved.id ?? newNoteId)
    setRestoredNotice(null)
    if (note) {
      showVersion(note)
      return
    }
    // A new note that never reached the database: nothing remains of it.
    live.current = { ...live.current, title: '', contentVersion: live.current.savedContentVersion, draftedEdits: -1 }
    sync()
    allowNextNavigation()
    navigate('/notes')
  }

  // An archived context stays listed only for a note already in it.
  const contextChoices = contexts.filter((context) => !context.archivedAt || context.id === contextId)
  const contextName = (id: string | null) => {
    if (!id) return 'Uncategorised'
    const context = contexts.find((entry) => entry.id === id)
    if (!context) return 'Unknown context'
    return context.archivedAt ? `${context.name} (archived)` : context.name
  }

  let status: string
  let warning = false
  if (view.conflict) {
    status = keptHere
      ? 'Not saved: two versions to choose from. Yours is kept on this computer.'
      : 'Not saved: two versions to choose from'
    warning = true
  } else if (phase.kind === 'saving') {
    status = 'Saving…'
  } else if (phase.kind === 'failed' && dirty) {
    warning = true
    if (phase.reason === 'offline') {
      status = keptHere
        ? 'Offline: kept on this computer. Will save when connected.'
        : 'Not saved: Nexus cannot reach the database. Retrying automatically.'
    } else if (phase.reason === 'refused') {
      status = keptHere
        ? 'Sign in again to save: your changes are kept on this computer.'
        : 'Not saved: checking your sign-in. Retrying automatically.'
    } else {
      status = `Not saved${keptHere ? ': kept on this computer' : ''}.${retrying ? ' Retrying automatically.' : ''}`
    }
  } else if (dirty) {
    status = 'Unsaved changes'
    warning = true
  } else if (phase.kind === 'saved') {
    status = `Saved ${londonClock(phase.at)}`
  } else if (phase.kind === 'refreshed') {
    status = `Updated from another device ${londonClock(phase.at)}`
  } else if (saved.updatedAt) {
    status = `Edited ${editedLabel(saved.updatedAt, new Date())}`
  } else {
    status = 'New note'
  }

  return (
    <div className={styles.editor}>
      <div className={styles.topBar}>
        <Link className={styles.back} to="/notes" aria-label="All notes">
          <ArrowLeft className={styles.smallIcon} aria-hidden="true" />
          <span className={styles.backText}>Notes</span>
        </Link>
        <select
          className={styles.context}
          aria-label="Context"
          value={contextId ?? ''}
          disabled={archived || view.conflict}
          onChange={(event) => editContext(event.target.value || null)}
        >
          <option value="">Uncategorised</option>
          {contextChoices.map((context) => (
            <option key={context.id} value={context.id}>
              {context.archivedAt ? `${context.name} (archived)` : context.name}
            </option>
          ))}
        </select>
        <span className={cx(styles.status, warning && styles.unsaved)} role="status">
          {status}
        </span>
        <div className={styles.actions}>
          {!isNew && !archived && !view.conflict && (
            <>
              <button
                className={styles.iconButton}
                type="button"
                aria-label={saved.pinned ? 'Unpin note' : 'Pin note'}
                aria-pressed={saved.pinned}
                title={saved.pinned ? 'Unpin note' : 'Pin note'}
                disabled={busy}
                onClick={togglePin}
              >
                <Pin className={styles.icon} aria-hidden="true" />
              </button>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Archive note"
                title={dirty ? 'Wait until your changes are saved' : 'Archive note'}
                disabled={busy || dirty}
                onClick={archive}
              >
                <Archive className={styles.icon} aria-hidden="true" />
              </button>
            </>
          )}
          {!archived && !view.conflict && (
            <button
              className={styles.saveNow}
              type="button"
              disabled={!dirty || phase.kind === 'saving'}
              onClick={() => void saveNow()}
            >
              Save now
            </button>
          )}
        </div>
      </div>

      {ownerId && !storageOk && (
        <p className={styles.storageNote}>
          This browser is not keeping copies of unsaved changes, so Nexus will warn you before you leave a note
          that is not yet saved.
        </p>
      )}

      {blocker.state === 'blocked' && leaveFailed && (
        <div className={styles.confirm} role="alertdialog" aria-labelledby={`${titleId}-confirm`}>
          <p id={`${titleId}-confirm`}>
            Your latest changes could not be saved, and this browser could not keep a copy. Leave without them?
          </p>
          <div className={styles.confirmActions}>
            <button
              className={styles.keep}
              type="button"
              autoFocus
              onClick={() => {
                setLeaveFailed(false)
                blocker.reset()
              }}
            >
              Keep editing
            </button>
            <button className={styles.textButton} type="button" onClick={() => blocker.proceed()}>
              Leave without saving
            </button>
          </div>
        </div>
      )}

      {keptCopy && !view.conflict && (
        <div className={styles.restored} role="status">
          <p>Your version was saved as a new note, “{keptCopy.title}”. This note shows the latest version.</p>
          <Link className={styles.textButton} to={`/notes/${keptCopy.id}`}>
            Open your version
          </Link>
        </div>
      )}

      {restoredNotice && !view.conflict && (
        <div className={styles.restored} role="status">
          <p>
            Restored your unsaved changes from this computer ({editedLabel(restoredNotice.changedAt, new Date())}).
            They will save automatically.
          </p>
          <button className={styles.textButton} type="button" onClick={discardRestored}>
            Discard them
          </button>
        </div>
      )}

      {problem && (
        <p className={form.error} role="alert">
          {problem}
        </p>
      )}

      {view.conflict && resolving && (
        <ConflictResolver
          key={`${resolving.heldId}:${resolution.latest?.revision ?? 'loading'}`}
          mine={resolving}
          latest={resolution.latest}
          loadError={resolution.loadError}
          onRetryLoad={() => void loadLatest(resolving.noteId)}
          contextName={contextName}
          busy={resolution.busy}
          error={resolution.error}
          notice={resolution.notice}
          waiting={resolution.queue.length - 1}
          onKeepBoth={() => void keepBoth()}
          onUseLatest={() => void chooseLatest()}
          onUseMine={() => void chooseMine()}
        />
      )}

      {archived && !view.conflict && (
        <div className={styles.archivedBanner}>
          <p>This note is archived. Restore it to edit.</p>
          <button className={styles.textButton} type="button" disabled={busy} onClick={() => void restore()}>
            <ArchiveRestore className={styles.smallIcon} aria-hidden="true" />
            Restore note
          </button>
        </div>
      )}

      {/* The editor stays in place during a conflict, hidden, so the version that stands can be shown at once. */}
      <div className={styles.page} hidden={view.conflict}>
        <label className="visually-hidden" htmlFor={titleId}>
          Title
        </label>
        <input
          id={titleId}
          className={styles.title}
          placeholder="Untitled"
          maxLength={limits.noteTitle}
          value={title}
          readOnly={archived || view.conflict}
          autoFocus={isNew}
          onChange={(event) => editTitle(event.target.value)}
        />
        {!archived && !view.conflict && <FormatToolbar editor={editor} />}
        <EditorContent editor={editor} className={styles.content} />
      </div>
    </div>
  )
}
