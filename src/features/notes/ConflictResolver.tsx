import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useState } from 'react'
import form from '../../components/Form/Form.module.css'
import type { Note, NoteDoc } from '../../data/types'
import { copyTitle } from './conflicts'
import type { NoteDraft } from './drafts'
import { createNoteExtensions } from './editor/extensions'
import { editedLabel } from './noteTime'
import editorStyles from './NoteEditor.module.css'
import styles from './ConflictResolver.module.css'

interface ConflictResolverProps {
  /** Your version: changes made on this computer. */
  mine: NoteDraft
  /** The latest version in the database; null while loading or if loading failed. */
  latest: Note | null
  loadError: string | null
  onRetryLoad: () => void
  contextName: (id: string | null) => string
  busy: boolean
  error: string | null
  /** Something the owner should know before choosing again (the note changed again). */
  notice: string | null
  /** Further versions waiting after this one. */
  waiting: number
  onKeepBoth: () => void
  onUseLatest: () => void
  onUseMine: () => void
}

/**
 * Two versions of one note, side by side, and three ways to settle them.
 * Nothing is written until the owner chooses, and the two choices that
 * discard something ask again first.
 */
export function ConflictResolver(props: ConflictResolverProps) {
  const { mine, latest, loadError, onRetryLoad, contextName, busy, error, notice, waiting } = props
  const [step, setStep] = useState<'choose' | 'confirm-latest' | 'confirm-mine'>('choose')
  const archived = Boolean(latest?.archivedAt)
  const ready = Boolean(latest) && !busy

  return (
    <section className={styles.resolver} aria-label="Resolve two versions">
      <header className={styles.header}>
        <h2 className={styles.heading}>This note has two versions</h2>
        <p className={styles.intro}>
          It changed on another device or tab after you made changes here. Nothing has been overwritten, and saving is
          paused for this note until you choose what to keep.
          {waiting > 0 && ` After this, ${waiting === 1 ? 'one more version' : `${waiting} more versions`} from this computer will need the same choice.`}
        </p>
      </header>

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <div className={styles.versions}>
        <article className={styles.version} aria-label="Your version">
          <h3 className={styles.versionHeading}>Your version</h3>
          <p className={styles.meta}>
            Changed on this computer · {editedLabel(mine.changedAt, new Date())} · {contextName(mine.contextId)}
          </p>
          <p className={styles.title}>{mine.title || 'Untitled'}</p>
          <ReadOnlyNote content={mine.content} label="Your version's text" />
        </article>

        <article className={styles.version} aria-label="Latest version">
          <h3 className={styles.versionHeading}>Latest version</h3>
          {latest ? (
            <>
              <p className={styles.meta}>
                Saved in Nexus · {editedLabel(latest.updatedAt, new Date())} · {contextName(latest.contextId)}
                {archived && ' · Archived'}
              </p>
              <p className={styles.title}>{latest.title || 'Untitled'}</p>
              <ReadOnlyNote key={latest.revision} content={latest.content} label="Latest version's text" />
            </>
          ) : loadError ? (
            <div className={styles.loadProblem}>
              <p className={form.error} role="alert">
                {loadError}
              </p>
              <button className={styles.secondary} type="button" disabled={busy} onClick={onRetryLoad}>
                Try again
              </button>
            </div>
          ) : (
            <p className={styles.meta}>Loading the latest version…</p>
          )}
        </article>
      </div>

      {error && (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}

      {step === 'choose' && (
        <div className={styles.choices}>
          <div className={styles.choice}>
            <button className={styles.primary} type="button" disabled={!ready} onClick={props.onKeepBoth}>
              Keep both (recommended)
            </button>
            <p className={styles.explain}>
              Saves your version as a new note, “{copyTitle(mine)}”, with its formatting and context. The latest
              version stays as it is.
            </p>
          </div>
          <div className={styles.choice}>
            <button className={styles.secondary} type="button" disabled={!ready} onClick={() => setStep('confirm-latest')}>
              Use latest version
            </button>
            <p className={styles.explain}>Discards your changes from this computer and shows the latest version.</p>
          </div>
          <div className={styles.choice}>
            <button
              className={styles.secondary}
              type="button"
              disabled={!ready || archived}
              onClick={() => setStep('confirm-mine')}
            >
              Use my version
            </button>
            <p className={styles.explain}>
              {archived
                ? 'Not available: this note has been archived, and an archived note is never changed or restored automatically. Keep both saves your version as a new, active note; or use the latest version, then restore the note and edit it.'
                : 'Replaces the latest version in Nexus with yours.'}
            </p>
          </div>
        </div>
      )}

      {step === 'confirm-latest' && (
        <div className={styles.confirm} role="alertdialog" aria-label="Confirm using the latest version">
          <p>
            Discard your changes? Your version will be removed from this computer and cannot be recovered. If you are
            unsure, choose Keep both instead.
          </p>
          <div className={styles.confirmActions}>
            <button className={styles.danger} type="button" disabled={!ready} onClick={props.onUseLatest}>
              Discard my changes
            </button>
            <button className={styles.secondary} type="button" autoFocus disabled={busy} onClick={() => setStep('choose')}>
              Back
            </button>
          </div>
        </div>
      )}

      {step === 'confirm-mine' && (
        <div className={styles.confirm} role="alertdialog" aria-label="Confirm using my version">
          <p>
            Replace the latest version with yours? The latest version in Nexus will be lost: Nexus keeps no older
            versions of notes. If you are unsure, choose Keep both instead.
          </p>
          <div className={styles.confirmActions}>
            <button className={styles.danger} type="button" disabled={!ready} onClick={props.onUseMine}>
              Replace with my version
            </button>
            <button className={styles.secondary} type="button" autoFocus disabled={busy} onClick={() => setStep('choose')}>
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** A note's formatted text, shown read-only through the editor (never as HTML). */
function ReadOnlyNote({ content, label }: { content: NoteDoc; label: string }) {
  const editor = useEditor({
    extensions: createNoteExtensions(),
    content: content as JSONContent,
    editable: false,
    editorProps: { attributes: { 'aria-label': label, class: editorStyles.prose } },
  })
  return <EditorContent editor={editor} className={styles.body} />
}
