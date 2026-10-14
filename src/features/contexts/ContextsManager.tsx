import { useId, useState, type FormEvent } from 'react'
import { useData } from '../../app/data/dataContext'
import form from '../../components/Form/Form.module.css'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import { limits, type Context } from '../../data/types'
import { useAction } from '../../lib/useAction'
import type { ContextsState } from './useContexts'
import styles from './ContextsManager.module.css'

/**
 * Create, rename, archive and restore contexts, and choose which ones the TV
 * may show. Self-contained, so any page can include it.
 */
export function ContextsManager({ contexts }: { contexts: ContextsState }) {
  const { contexts: service } = useData()
  const { busy, error, run } = useAction()
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const headingId = useId()

  const act = async (work: () => Promise<unknown>) => {
    const ok = await run(work)
    if (ok) contexts.reload()
    return ok
  }

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (await act(() => service.create(newName))) setNewName('')
  }

  const saveRename = async (event: FormEvent) => {
    event.preventDefault()
    if (editing && (await act(() => service.rename(editing.id, editing.name)))) setEditing(null)
  }

  return (
    <GlassPanel as="section" padding="md" className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Contexts
      </h2>
      <p className={styles.intro}>
        Contexts group your tasks, and later your notes and calendar. The TV shows tasks only from
        contexts with “Show on TV” switched on.
      </p>

      {error && (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}
      {contexts.error && (
        <p className={form.error} role="alert">
          {contexts.error}
        </p>
      )}

      {contexts.loading ? (
        <p className={styles.muted}>Loading contexts…</p>
      ) : (
        <ul className={styles.list}>
          {contexts.active.map((context) =>
            editing?.id === context.id ? (
              <li key={context.id}>
                <form className={styles.rename} onSubmit={saveRename}>
                  <input
                    className={form.input}
                    aria-label={`New name for ${context.name}`}
                    maxLength={limits.contextName}
                    required
                    value={editing.name}
                    onChange={(event) => setEditing({ id: context.id, name: event.target.value })}
                  />
                  <button className={styles.textButton} type="submit" disabled={busy}>
                    Save
                  </button>
                  <button className={styles.textButton} type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              </li>
            ) : (
              <ContextRow
                key={context.id}
                context={context}
                busy={busy}
                onRename={() => setEditing({ id: context.id, name: context.name })}
                onToggleTv={(value) => act(() => service.setShowOnTv(context.id, value))}
                onArchive={() => act(() => service.setArchived(context.id, true))}
              />
            ),
          )}
          {contexts.active.length === 0 && <li className={styles.muted}>No contexts yet.</li>}
        </ul>
      )}

      <form className={styles.add} onSubmit={add}>
        <input
          className={form.input}
          aria-label="New context name"
          placeholder="New context, for example Personal"
          maxLength={limits.contextName}
          required
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button className={styles.addButton} type="submit" disabled={busy || !newName.trim()} aria-label="Add context">
          Add
        </button>
      </form>

      {contexts.archived.length > 0 && (
        <div className={styles.archived}>
          <h3 className={styles.subheading}>Archived</h3>
          <ul className={styles.list}>
            {contexts.archived.map((context) => (
              <li key={context.id} className={styles.row}>
                <span className={styles.name}>{context.name}</span>
                <button
                  className={styles.textButton}
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => service.setArchived(context.id, false))}
                  aria-label={`Restore ${context.name}`}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassPanel>
  )
}

interface ContextRowProps {
  context: Context
  busy: boolean
  onRename: () => void
  onToggleTv: (value: boolean) => void
  onArchive: () => void
}

function ContextRow({ context, busy, onRename, onToggleTv, onArchive }: ContextRowProps) {
  return (
    <li className={styles.row}>
      <span className={styles.name}>{context.name}</span>
      <label className={form.switch}>
        <input
          type="checkbox"
          role="switch"
          checked={context.showOnTv}
          disabled={busy}
          onChange={(event) => onToggleTv(event.target.checked)}
          aria-label={`Show ${context.name} on TV`}
        />
        <span className={form.switchLabel} aria-hidden="true">
          TV
        </span>
      </label>
      <button className={styles.textButton} type="button" onClick={onRename} aria-label={`Rename ${context.name}`}>
        Rename
      </button>
      <button
        className={styles.textButton}
        type="button"
        disabled={busy}
        onClick={onArchive}
        aria-label={`Archive ${context.name}`}
      >
        Archive
      </button>
    </li>
  )
}
