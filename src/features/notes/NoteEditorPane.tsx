import type { JSONContent } from '@tiptap/core'
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
import { createNoteExtensions } from './editor/extensions'
import { FormatToolbar } from './editor/FormatToolbar'
import { editedLabel } from './noteTime'
import { autosaveTiming, useAutosave, type SaveOutcome } from './useAutosave'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'
import styles from './NoteEditor.module.css'

const emptyDoc: NoteDoc = { type: 'doc', content: [] }

interface NoteEditorPaneProps {
  /** Null for a new note that has not been saved yet. */
  noteId: string | null
  /** Identifies this editing session; unchanged when a new note gets its address. */
  editorSession: string
  contexts: Context[]
  /** Called after anything the notes list shows has changed. */
  onChanged: () => void
}

/**
 * Loads one note (or starts a new one) and shows it in the editor. The note
 * is loaded once: when a new note's first save gives it an address, the same
 * editor carries on.
 */
export function NoteEditorPane({ noteId, editorSession, contexts, onChanged }: NoteEditorPaneProps) {
  const { notes } = useData()
  const { actions } = useAuth()
  const [initialId] = useState(noteId)
  const [loaded, setLoaded] = useState<Note | null>(null)
  const [failure, setFailure] = useState<DataError | null>(null)

  useEffect(() => {
    if (!initialId) return
    let active = true
    notes.get(initialId).then(
      (note) => {
        if (active) setLoaded(note)
      },
      (error: unknown) => {
        if (!active) return
        const problem = error instanceof DataError ? error : new DataError('unknown', String(error))
        if (problem.kind === 'refused') void actions.recheck()
        setFailure(problem)
      },
    )
    return () => {
      active = false
    }
  }, [initialId, notes, actions])

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
  if (initialId && !loaded) return <p className={styles.loading}>Opening note…</p>

  return <NoteEditor note={loaded} editorSession={editorSession} contexts={contexts} onChanged={onChanged} />
}

interface NoteEditorProps {
  note: Note | null
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
  conflict: boolean
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

function NoteEditor({ note, editorSession, contexts, onChanged }: NoteEditorProps) {
  const { notes } = useData()
  const { actions } = useAuth()
  const navigate = useNavigate()
  const titleId = useId()
  // A new note's id is fixed now, so a retried first save can never create a second note.
  const [newNoteId] = useState(() => crypto.randomUUID())

  // view draws the screen; live holds the same values for saving, updated
  // the moment anything changes. sync() copies live into view.
  const [view, setView] = useState<Live>(() => ({
    saved: savedFrom(note),
    title: note?.title ?? '',
    contextId: note?.contextId ?? null,
    contentVersion: 0,
    savedContentVersion: 0,
    edits: 0,
    conflict: false,
  }))
  const live = useRef<Live>({ ...view })
  const sync = useCallback(() => setView({ ...live.current }), [])

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [leaveFailed, setLeaveFailed] = useState(false)

  const { saved, title, contextId } = view
  const archived = Boolean(saved.archivedAt)
  const isNew = saved.id === null
  const dirty = unsaved(view)

  const editor = useEditor({
    extensions: createNoteExtensions(),
    content: (note?.content ?? emptyDoc) as JSONContent,
    editable: !archived,
    editorProps: { attributes: { 'aria-label': 'Note text', class: styles.prose } },
    onUpdate: () => {
      live.current.contentVersion += 1
      live.current.edits += 1
      sync()
    },
  })

  useEffect(() => {
    // Without false, switching would count as an edit.
    editor.setEditable(!archived, false)
  }, [editor, archived])

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

  const { blocker, allowNextNavigation } = useUnsavedChangesGuard(dirty)

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
      sync()
      setPhase({ kind: 'saved', at: new Date() })
      onChanged()
      if (base.id === null) {
        // Give the new note its address without leaving this editor.
        allowNextNavigation()
        navigate(`/notes/${result.id}`, { replace: true, state: { editorSession } })
      }
      return 'saved'
    } catch (error) {
      const failure = error instanceof DataError ? error : new DataError('unknown', String(error))
      if (failure.kind === 'conflict') {
        // Stop saving this note until the owner decides; nothing is overwritten.
        live.current.conflict = true
        sync()
        setPhase({ kind: 'idle' })
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
  }, [editor, notes, newNoteId, sync, onChanged, allowNextNavigation, navigate, editorSession, actions])

  const { saveNow, retrying } = useAutosave({
    editCount: view.edits,
    isDirty: () => unsaved(live.current),
    save: saveOnce,
  })

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

  // Leaving with unsaved changes: save first, then go. Ask only if saving fails.
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let active = true
    void saveNow().then((outcome) => {
      if (!active) return
      if (outcome === 'saved' && !unsaved(live.current)) blocker.proceed()
      else setLeaveFailed(true)
    })
    return () => {
      active = false
    }
  }, [blocker, saveNow])

  /** Shows a newer version from the database in place of what is on screen. */
  const showVersion = useCallback(
    (fresh: Note) => {
      editor.commands.setContent(fresh.content as JSONContent, { emitUpdate: false })
      live.current = {
        ...live.current,
        saved: savedFrom(fresh),
        title: fresh.title,
        contextId: fresh.contextId,
        savedContentVersion: live.current.contentVersion,
        conflict: false,
      }
      sync()
    },
    [editor, sync],
  )

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
          if (!active || live.current.edits !== editsBefore || unsaved(live.current)) return
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
      const failure = error instanceof DataError ? error : new DataError('unknown', String(error))
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

  const reloadNote = async () => {
    if (!saved.id) return
    setBusy(true)
    try {
      showVersion(await notes.get(saved.id))
      setPhase({ kind: 'idle' })
      setProblem(null)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  // An archived context stays listed only for a note already in it.
  const contextChoices = contexts.filter((context) => !context.archivedAt || context.id === contextId)

  let status: string
  let warning = false
  if (view.conflict) {
    status = 'Not saved: changed on another device'
    warning = true
  } else if (phase.kind === 'saving') {
    status = 'Saving…'
  } else if (phase.kind === 'failed' && dirty) {
    warning = true
    status =
      phase.reason === 'offline'
        ? 'Not saved: Nexus cannot reach the database. Retrying automatically.'
        : phase.reason === 'refused'
          ? 'Not saved: checking your sign-in. Retrying automatically.'
          : retrying
            ? 'Not saved. Retrying automatically.'
            : 'Not saved.'
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
          disabled={archived}
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
          {!isNew && !archived && (
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
          {!archived && (
            <button
              className={styles.saveNow}
              type="button"
              disabled={!dirty || phase.kind === 'saving' || view.conflict}
              onClick={() => void saveNow()}
            >
              Save now
            </button>
          )}
        </div>
      </div>

      {blocker.state === 'blocked' && leaveFailed && (
        <div className={styles.confirm} role="alertdialog" aria-labelledby={`${titleId}-confirm`}>
          <p id={`${titleId}-confirm`}>Your latest changes could not be saved. Leave without them?</p>
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

      {view.conflict && (
        <div className={styles.conflict} role="alert">
          <p>
            This note was changed on another device since you opened it. Nothing was overwritten, and your changes
            here are not being saved. Copy anything you want to keep, then reload the note.
          </p>
          <button className={styles.textButton} type="button" disabled={busy} onClick={() => void reloadNote()}>
            Reload note
          </button>
        </div>
      )}
      {problem && (
        <p className={form.error} role="alert">
          {problem}
        </p>
      )}
      {archived && (
        <div className={styles.archivedBanner}>
          <p>This note is archived. Restore it to edit.</p>
          <button className={styles.textButton} type="button" disabled={busy} onClick={() => void restore()}>
            <ArchiveRestore className={styles.smallIcon} aria-hidden="true" />
            Restore note
          </button>
        </div>
      )}

      <div className={styles.page}>
        <label className="visually-hidden" htmlFor={titleId}>
          Title
        </label>
        <input
          id={titleId}
          className={styles.title}
          placeholder="Untitled"
          maxLength={limits.noteTitle}
          value={title}
          readOnly={archived}
          autoFocus={isNew}
          onChange={(event) => editTitle(event.target.value)}
        />
        {!archived && <FormatToolbar editor={editor} />}
        <EditorContent editor={editor} className={styles.content} />
      </div>
    </div>
  )
}
