import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { Archive, ArchiveRestore, ArrowLeft, Pin } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../../app/auth/authContext'
import { useData } from '../../app/data/dataContext'
import form from '../../components/Form/Form.module.css'
import { DataError, limits, type Context, type Note, type NoteChanges, type NoteDoc } from '../../data/types'
import { cx } from '../../lib/cx'
import { createNoteExtensions } from './editor/extensions'
import { FormatToolbar } from './editor/FormatToolbar'
import { editedLabel } from './noteTime'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'
import styles from './NoteEditor.module.css'

const emptyDoc: NoteDoc = { type: 'doc', content: [] }

interface NoteEditorPaneProps {
  /** Null for a new note that has not been saved yet. */
  noteId: string | null
  contexts: Context[]
  /** Called after anything the notes list shows has changed. */
  onChanged: () => void
}

/** Loads one note (or starts a new one) and shows it in the editor. */
export function NoteEditorPane({ noteId, contexts, onChanged }: NoteEditorPaneProps) {
  const { notes } = useData()
  const { actions } = useAuth()
  const location = useLocation()
  // A note saved for the first time arrives with the address change, so it
  // need not be loaded again.
  const handedOver = (location.state as { note?: Note } | null)?.note
  const [loaded, setLoaded] = useState<{ id: string; note: Note } | null>(
    handedOver && handedOver.id === noteId ? { id: handedOver.id, note: handedOver } : null,
  )
  const [failure, setFailure] = useState<DataError | null>(null)

  useEffect(() => {
    if (!noteId || loaded?.id === noteId) return
    let active = true
    notes.get(noteId).then(
      (note) => {
        if (active) setLoaded({ id: noteId, note })
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
  }, [noteId, loaded, notes, actions])

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
  if (noteId && !loaded) return <p className={styles.loading}>Opening note…</p>

  return <NoteEditor note={loaded?.note ?? null} contexts={contexts} onChanged={onChanged} />
}

interface NoteEditorProps {
  note: Note | null
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

function NoteEditor({ note, contexts, onChanged }: NoteEditorProps) {
  const { notes } = useData()
  const { actions } = useAuth()
  const navigate = useNavigate()
  const titleId = useId()

  const [saved, setSaved] = useState<Saved>(() => savedFrom(note))
  const [title, setTitle] = useState(saved.title)
  const [contextId, setContextId] = useState<string | null>(saved.contextId)
  // Every edit to the text raises contentVersion; savedVersion is the
  // version last saved. Typing while a save is on its way stays unsaved.
  const [contentVersion, setContentVersion] = useState(0)
  const [savedVersion, setSavedVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [justSaved, setJustSaved] = useState<Date | null>(null)

  const archived = Boolean(saved.archivedAt)
  const isNew = saved.id === null

  const editor = useEditor({
    extensions: createNoteExtensions(),
    content: (note?.content ?? emptyDoc) as JSONContent,
    editable: !archived,
    editorProps: { attributes: { 'aria-label': 'Note text', class: styles.prose } },
    onUpdate: () => setContentVersion((version) => version + 1),
  })

  useEffect(() => {
    // Without false, switching would count as an edit.
    editor.setEditable(!archived, false)
  }, [editor, archived])

  const contentChanged = contentVersion !== savedVersion
  const dirty = isNew
    ? title.trim() !== '' || contentChanged
    : title !== saved.title || contextId !== saved.contextId || contentChanged
  const canSave = dirty && !busy && !conflict && !archived

  const { blocker, allowNextNavigation } = useUnsavedChangesGuard(dirty)

  const report = useCallback(
    (error: unknown) => {
      const failure = error instanceof DataError ? error : new DataError('unknown', String(error))
      if (failure.kind === 'conflict') setConflict(true)
      else setProblem(failure.message)
      if (failure.kind === 'refused') void actions.recheck()
    },
    [actions],
  )

  const save = useCallback(async () => {
    if (!canSave) return
    setBusy(true)
    setProblem(null)
    const version = contentVersion
    const content = editor.getJSON() as NoteDoc
    try {
      if (saved.id === null) {
        const created = await notes.create({ title, content, contextId })
        onChanged()
        allowNextNavigation()
        navigate(`/notes/${created.id}`, { replace: true, state: { note: created } })
        return
      }
      const changes: NoteChanges = {}
      if (title !== saved.title) changes.title = title
      if (contextId !== saved.contextId) changes.contextId = contextId
      if (contentChanged) changes.content = content
      const result = await notes.save(saved.id, changes, saved.revision)
      setSaved(savedFrom(result))
      setSavedVersion(version)
      setJustSaved(new Date())
      onChanged()
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }, [canSave, contentVersion, editor, saved, notes, title, contextId, contentChanged, onChanged, allowNextNavigation, navigate, report])

  // Ctrl+S or Cmd+S saves, wherever the cursor is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const runAction = async (work: () => Promise<Partial<Saved>>, after?: () => void) => {
    setBusy(true)
    setProblem(null)
    try {
      const changed = await work()
      setSaved((current) => ({ ...current, ...changed }))
      onChanged()
      after?.()
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }

  const togglePin = () =>
    runAction(async () => ({ pinned: (await notes.setPinned(saved.id!, !saved.pinned)).pinned }))
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
      const fresh = await notes.get(saved.id)
      editor.commands.setContent(fresh.content as JSONContent, { emitUpdate: false })
      setSaved(savedFrom(fresh))
      setTitle(fresh.title)
      setContextId(fresh.contextId)
      setSavedVersion(contentVersion)
      setConflict(false)
      setProblem(null)
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }

  // An archived context stays listed only for a note already in it.
  const contextChoices = contexts.filter((context) => !context.archivedAt || context.id === contextId)

  let status: string
  if (busy) status = 'Saving…'
  else if (dirty) status = 'Unsaved changes'
  else if (justSaved) status = `Saved ${editedLabel(justSaved.toISOString(), new Date())}`
  else if (saved.updatedAt) status = `Edited ${editedLabel(saved.updatedAt, new Date())}`
  else status = 'New note'

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
          onChange={(event) => setContextId(event.target.value || null)}
        >
          <option value="">Uncategorised</option>
          {contextChoices.map((context) => (
            <option key={context.id} value={context.id}>
              {context.archivedAt ? `${context.name} (archived)` : context.name}
            </option>
          ))}
        </select>
        <span className={cx(styles.status, dirty && styles.unsaved)} role="status">
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
                title={dirty ? 'Save or discard your changes first' : 'Archive note'}
                disabled={busy || dirty}
                onClick={archive}
              >
                <Archive className={styles.icon} aria-hidden="true" />
              </button>
            </>
          )}
          {!archived && (
            <button className={styles.save} type="button" disabled={!canSave} onClick={() => void save()}>
              Save
            </button>
          )}
        </div>
      </div>

      {blocker.state === 'blocked' && (
        <div className={styles.confirm} role="alertdialog" aria-labelledby={`${titleId}-confirm`}>
          <p id={`${titleId}-confirm`}>This note has unsaved changes. Leave without saving them?</p>
          <div className={styles.confirmActions}>
            <button className={styles.save} type="button" autoFocus onClick={() => blocker.reset()}>
              Keep editing
            </button>
            <button className={styles.textButton} type="button" onClick={() => blocker.proceed()}>
              Discard changes
            </button>
          </div>
        </div>
      )}

      {conflict && (
        <div className={styles.conflict} role="alert">
          <p>
            This note was changed on another device since you opened it. Nothing was overwritten. Copy anything you
            want to keep, then reload the note.
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
          onChange={(event) => setTitle(event.target.value)}
        />
        {!archived && <FormatToolbar editor={editor} />}
        <EditorContent editor={editor} className={styles.content} />
      </div>
    </div>
  )
}
