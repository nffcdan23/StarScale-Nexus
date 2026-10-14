import { useCallback, useState, type FormEvent } from 'react'
import { useData } from '../../app/data/dataContext'
import form from '../../components/Form/Form.module.css'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import { PriorityBadge } from '../../components/PriorityBadge/PriorityBadge'
import { limits, type Context, type Priority, type Task } from '../../data/types'
import { formatDayMonth } from '../../lib/time'
import { useAction } from '../../lib/useAction'
import { useLoad } from '../../lib/useLoad'
import styles from './TasksPanel.module.css'

const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

/** Open tasks first by priority, then oldest first. */
function sortOpen(tasks: Task[]) {
  return [...tasks].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.createdAt.localeCompare(b.createdAt),
  )
}

/** Quick add, the open task list, and recently completed tasks. */
export function TasksPanel({ contexts }: { contexts: Context[] }) {
  const { tasks } = useData()
  const open = useLoad(useCallback(() => tasks.list('open'), [tasks]))
  const done = useLoad(useCallback(() => tasks.list('done'), [tasks]))
  const { busy, error, run } = useAction()

  const contextName = (id: string) => {
    const context = contexts.find((entry) => entry.id === id)
    if (!context) return 'Unknown context'
    return context.archivedAt ? `${context.name} (archived)` : context.name
  }

  const reloadAll = () => {
    open.reload()
    done.reload()
  }

  const toggle = (task: Task) => run(() => tasks.setDone(task.id, task.status === 'open')).then((ok) => ok && reloadAll())

  const activeContexts = contexts.filter((context) => !context.archivedAt)
  const loadError = open.error ?? done.error

  return (
    <div className={styles.column}>
      <QuickAdd contexts={activeContexts} onAdded={open.reload} />

      {error && (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}
      {loadError && (
        <p className={form.error} role="alert">
          {loadError}{' '}
          <button className={styles.inlineButton} type="button" onClick={reloadAll}>
            Try again
          </button>
        </p>
      )}

      <GlassPanel as="section" padding="md" aria-label="Open tasks">
        <h2 className={styles.heading}>
          Open <span className={styles.count}>{open.data?.length ?? ''}</span>
        </h2>
        {open.loading && !open.data ? (
          <p className={styles.muted}>Loading tasks…</p>
        ) : open.data && open.data.length > 0 ? (
          <ul className={styles.list}>
            {sortOpen(open.data).map((task) => (
              <TaskRow key={task.id} task={task} context={contextName(task.contextId)} busy={busy} onToggle={toggle} />
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Nothing open. Add a task above.</p>
        )}
      </GlassPanel>

      {done.data && done.data.length > 0 && (
        <GlassPanel as="section" padding="md" aria-label="Completed tasks">
          <h2 className={styles.heading}>
            Completed <span className={styles.count}>{done.data.length}</span>
          </h2>
          <ul className={styles.list}>
            {done.data.map((task) => (
              <TaskRow key={task.id} task={task} context={contextName(task.contextId)} busy={busy} onToggle={toggle} />
            ))}
          </ul>
        </GlassPanel>
      )}
    </div>
  )
}

function QuickAdd({ contexts, onAdded }: { contexts: Context[]; onAdded: () => void }) {
  const { tasks } = useData()
  const { busy, error, run } = useAction()
  const [title, setTitle] = useState('')
  const [chosenContext, setChosenContext] = useState<string | null>(null)
  // Fall back to the first context if the chosen one has been archived.
  const contextId = contexts.some((context) => context.id === chosenContext) ? chosenContext! : contexts[0]?.id

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!contextId) return
    // The typed title is kept if saving fails, so nothing is lost.
    if (await run(() => tasks.create({ contextId, title }))) {
      setTitle('')
      onAdded()
    }
  }

  return (
    <GlassPanel as="section" padding="md" aria-label="Add a task">
      <form className={styles.quickAdd} onSubmit={submit}>
        <input
          className={`${form.input} ${styles.titleInput}`}
          aria-label="New task"
          placeholder="Add a task"
          maxLength={limits.taskTitle}
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <select
          className={`${form.input} ${styles.select}`}
          aria-label="Context for the new task"
          value={contextId ?? ''}
          onChange={(event) => setChosenContext(event.target.value)}
        >
          {contexts.map((context) => (
            <option key={context.id} value={context.id}>
              {context.name}
            </option>
          ))}
        </select>
        <button className={styles.addButton} type="submit" disabled={busy || !title.trim() || !contextId} aria-label="Add task">
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>
      {error && (
        <p className={`${form.error} ${styles.formError}`} role="alert">
          {error}
        </p>
      )}
    </GlassPanel>
  )
}

interface TaskRowProps {
  task: Task
  context: string
  busy: boolean
  onToggle: (task: Task) => void
}

function TaskRow({ task, context, busy, onToggle }: TaskRowProps) {
  const done = task.status === 'done'
  return (
    <li className={styles.row}>
      <input
        type="checkbox"
        className={styles.check}
        checked={done}
        disabled={busy}
        onChange={() => onToggle(task)}
        aria-label={done ? `Reopen “${task.title}”` : `Complete “${task.title}”`}
      />
      <div className={styles.text}>
        <span className={done ? styles.doneTitle : styles.title}>{task.title}</span>
        <span className={styles.meta}>
          {context}
          {done && task.completedAt ? ` · Completed ${formatDayMonth(new Date(task.completedAt))}` : ''}
        </span>
      </div>
      {!done && <PriorityBadge priority={task.priority} />}
    </li>
  )
}
