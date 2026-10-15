import { useId } from 'react'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import type { NoteDraft } from './drafts'
import styles from './SignOutDialog.module.css'

interface SignOutDialogProps {
  drafts: NoteDraft[]
  busy: boolean
  onKeep: () => void
  onDelete: () => void
  onCancel: () => void
}

/**
 * Shown when signing out while notes have changes that have not reached the
 * database. Keeping them is the safe choice and has the focus.
 */
export function SignOutDialog({ drafts, busy, onKeep, onDelete, onCancel }: SignOutDialogProps) {
  const headingId = useId()
  const count = drafts.length
  const titles = [...new Set(drafts.map((draft) => draft.title || 'Untitled'))]

  return (
    <div className={styles.backdrop}>
      <GlassPanel
        as="section"
        tone="strong"
        padding="lg"
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      >
        <h2 id={headingId} className={styles.heading}>
          {count === 1 ? '1 note has' : `${count} notes have`} changes not yet saved to Nexus
        </h2>
        <ul className={styles.titles}>
          {titles.slice(0, 5).map((title) => (
            <li key={title}>{title}</li>
          ))}
          {titles.length > 5 && <li>and {titles.length - 5} more</li>}
        </ul>
        <p className={styles.text}>
          They are kept on this computer. If you keep them, they will be saved the next time you sign in to Nexus
          here. Anyone using this computer and browser could read them until then.
        </p>
        <div className={styles.actions}>
          <button className={styles.primary} type="button" autoFocus disabled={busy} onClick={onKeep}>
            Keep them on this computer and sign out
          </button>
          <button className={styles.danger} type="button" disabled={busy} onClick={onDelete}>
            Delete them and sign out
          </button>
          <button className={styles.secondary} type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </GlassPanel>
    </div>
  )
}
