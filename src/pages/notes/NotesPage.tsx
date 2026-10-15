import { useCallback, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { useData } from '../../app/data/dataContext'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import { useContexts } from '../../features/contexts/useContexts'
import { NoteEditorPane } from '../../features/notes/NoteEditorPane'
import { NotesList, type NotesView } from '../../features/notes/NotesList'
import { cx } from '../../lib/cx'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useLoad } from '../../lib/useLoad'
import styles from './NotesPage.module.css'

/**
 * The Notes workspace: the notes list beside the editor (the sidebar is the
 * first column). /notes shows the list, /notes/new a note not yet saved, and
 * /notes/<id> one note. On narrow screens one of the two shows at a time.
 * Loaded only when opened, because it carries the editor.
 */
export function NotesPage() {
  useDocumentTitle('Notes')
  const { noteId } = useParams()
  // A new note keeps the same editor when its first save gives it an address,
  // so typing is never interrupted. Each New note starts a fresh session.
  const editorSession = (useLocation().state as { editorSession?: string } | null)?.editorSession
  const { notes } = useData()
  const contexts = useContexts()
  const [view, setView] = useState<NotesView>('active')

  // Each result remembers which list it belongs to, so switching lists never
  // shows the previous list under the new heading.
  const list = useLoad(
    useCallback(() => notes.list({ archived: view === 'archived' }).then((items) => ({ view, items })), [notes, view]),
  )
  const shown = list.data?.view === view ? list.data.items : undefined

  return (
    <div className={cx(styles.workspace, noteId && styles.noteOpen)}>
      <GlassPanel as="section" padding="md" className={styles.listPanel} aria-label="Notes list">
        <NotesList
          view={view}
          onViewChange={setView}
          notes={shown}
          error={list.error}
          onRetry={list.reload}
          contexts={contexts.all}
        />
      </GlassPanel>

      <GlassPanel as="section" padding="md" className={styles.editorPanel} aria-label="Note">
        {noteId ? (
          <NoteEditorPane
            key={editorSession ?? noteId}
            noteId={noteId === 'new' ? null : noteId}
            editorSession={editorSession ?? noteId}
            contexts={contexts.all}
            onChanged={list.reload}
          />
        ) : (
          <p className={styles.empty}>Choose a note, or press New note to start one.</p>
        )}
      </GlassPanel>
    </div>
  )
}
