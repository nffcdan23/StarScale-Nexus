import { Pin, Plus } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router'
import form from '../../components/Form/Form.module.css'
import type { Context, NoteSummary } from '../../data/types'
import { noteText } from '../../lib/noteText'
import { cx } from '../../lib/cx'
import type { NoteDraft } from './drafts'
import { editedLabel } from './noteTime'
import styles from './NotesList.module.css'

export type NotesView = 'active' | 'archived'

interface NotesListProps {
  view: NotesView
  onViewChange: (view: NotesView) => void
  /** Undefined while loading. */
  notes: NoteSummary[] | undefined
  error: string | undefined
  onRetry: () => void
  contexts: Context[]
  /** Unsaved changes kept on this computer. */
  drafts: NoteDraft[]
}

/** Pinned and recent notes (or archived ones), with New note. */
export function NotesList({ view, onViewChange, notes, error, onRetry, contexts, drafts }: NotesListProps) {
  const navigate = useNavigate()
  const now = new Date()

  const contextName = (id: string | null) => {
    if (!id) return 'Uncategorised'
    const context = contexts.find((entry) => entry.id === id)
    if (!context) return 'Unknown context'
    return context.archivedAt ? `${context.name} (archived)` : context.name
  }

  const draftFor = (id: string) => drafts.find((draft) => draft.noteId === id && !draft.held)
  const heldFor = (id: string) => drafts.find((draft) => draft.noteId === id && draft.held)
  // New notes that so far exist only on this computer.
  const unsavedNew = notes
    ? drafts.filter((draft) => draft.isNew && !draft.held && !notes.some((note) => note.id === draft.noteId))
    : []

  const firstLine = (text: string) => text.split('\n').find((line) => line.trim()) ?? ''

  const renderNote = (note: NoteSummary) => (
    <li key={note.id}>
      <NavLink to={`/notes/${note.id}`} className={({ isActive }) => cx(styles.item, isActive && styles.selected)}>
        <span className={styles.itemTitle}>
          {note.pinned && (
            <>
              <Pin className={styles.pinIcon} aria-hidden="true" />
              <span className="visually-hidden">Pinned: </span>
            </>
          )}
          <span className={cx(!note.title && styles.untitled)}>{note.title || 'Untitled'}</span>
        </span>
        {note.preview && <span className={styles.preview}>{note.preview.split('\n')[0]}</span>}
        <span className={styles.meta}>
          {contextName(note.contextId)} · {editedLabel(view === 'archived' ? (note.archivedAt ?? note.updatedAt) : note.updatedAt, now)}
        </span>
        {draftFor(note.id) && <span className={styles.draftBadge}>Unsaved changes on this computer</span>}
        {heldFor(note.id) && <span className={styles.draftBadge}>Two versions to resolve</span>}
      </NavLink>
    </li>
  )

  const pinned = notes?.filter((note) => note.pinned) ?? []
  const recent = notes?.filter((note) => !note.pinned) ?? []

  return (
    <div className={styles.list}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Notes</h1>
        <button className={styles.newButton} type="button" onClick={() => navigate('/notes/new', { state: { editorSession: crypto.randomUUID() } })}>
          <Plus className={styles.plusIcon} aria-hidden="true" />
          New note
        </button>
      </div>

      <div className={styles.views} role="group" aria-label="Show notes">
        {(['active', 'archived'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={cx(styles.view, view === option && styles.viewActive)}
            aria-pressed={view === option}
            onClick={() => onViewChange(option)}
          >
            {option === 'active' ? 'Notes' : 'Archived'}
          </button>
        ))}
      </div>

      {error && (
        <p className={form.error} role="alert">
          {error}{' '}
          <button className={styles.retry} type="button" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}

      {!notes ? (
        !error && <p className={styles.muted}>Loading notes…</p>
      ) : notes.length === 0 && (view === 'archived' || unsavedNew.length === 0) ? (
        <p className={styles.muted}>{view === 'archived' ? 'No archived notes.' : 'No notes yet.'}</p>
      ) : view === 'archived' ? (
        <ul className={styles.items} aria-label="Archived notes">
          {notes.map(renderNote)}
        </ul>
      ) : (
        <>
          {unsavedNew.length > 0 && <UnsavedNew drafts={unsavedNew} now={now} firstLine={firstLine} />}
          {pinned.length > 0 && (
            <section aria-label="Pinned notes">
              <h2 className={styles.sectionTitle}>Pinned</h2>
              <ul className={styles.items}>{pinned.map(renderNote)}</ul>
            </section>
          )}
          {recent.length > 0 && (
            <section aria-label="Recent notes">
              <h2 className={styles.sectionTitle}>Recent</h2>
              <ul className={styles.items}>{recent.map(renderNote)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

interface UnsavedNewProps {
  drafts: NoteDraft[]
  now: Date
  firstLine: (text: string) => string
}

/** New notes whose first save has not yet reached the database. */
function UnsavedNew({ drafts, now, firstLine }: UnsavedNewProps) {
  return (
    <section aria-label="Notes not saved yet">
      <h2 className={styles.sectionTitle}>Not saved yet</h2>
      <ul className={styles.items}>
        {drafts.map((draft) => (
          <li key={draft.noteId}>
            <NavLink to={`/notes/${draft.noteId}`} className={({ isActive }) => cx(styles.item, isActive && styles.selected)}>
              <span className={styles.itemTitle}>
                <span className={cx(!draft.title && styles.untitled)}>{draft.title || 'Untitled'}</span>
              </span>
              {firstLine(noteText(draft.content)) && <span className={styles.preview}>{firstLine(noteText(draft.content))}</span>}
              <span className={styles.draftBadge}>Only on this computer · {editedLabel(draft.changedAt, now)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </section>
  )
}
