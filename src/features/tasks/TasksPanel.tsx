import { useCallback, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { useData } from '../../app/data/dataContext'
import form from '../../components/Form/Form.module.css'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import { PriorityBadge } from '../../components/PriorityBadge/PriorityBadge'
import { TaskCheck } from '../../components/TaskCheck/TaskCheck'
import { limits, type Context, type Priority, type Task, type TaskView } from '../../data/types'
import { cx } from '../../lib/cx'
import { deadlineState, formatDeadline } from '../../lib/deadlines'
import { formatDayMonth } from '../../lib/time'
import { useAction } from '../../lib/useAction'
import { useMinuteClock } from '../../lib/useMinuteClock'
import { useLoad } from '../../lib/useLoad'
import { TaskEditor } from './TaskEditor'
import styles from './TasksPanel.module.css'

const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

/** Open tasks first by priority, then oldest first. */
function sortOpen(tasks: Task[]) {
  return [...tasks].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.createdAt.localeCompare(b.createdAt),
  )
}

const views: Array<{ view: TaskView; label: string; empty: string }> = [
  { view: 'open', label: 'Open', empty: 'Nothing open. Add a task above.' },
  { view: 'done', label: 'Completed', empty: 'No completed tasks yet.' },
  { view: 'archived', label: 'Archived', empty: 'No archived tasks.' },
]

/** Quick add, and one list of tasks: open, completed or archived. */
export function TasksPanel({ contexts }: { contexts: Context[] }) {
  const { tasks } = useData()
  // The chosen list lives in the address (/tasks?view=done), so other pages
  // can link straight to it and a reload keeps it.
  const [searchParams, setSearchParams] = useSearchParams()
  const view: TaskView = views.find((entry) => entry.view === searchParams.get('view'))?.view ?? 'open'
  const [editingId, setEditingId] = useState<string | null>(null)
  // Each result remembers which list it belongs to, so switching lists never
  // shows the previous list's tasks under the new heading.
  const list = useLoad(useCallback(() => tasks.list(view).then((items) => ({ view, items })), [tasks, view]))
  const { busy, error, run } = useAction()
  const now = useMinuteClock()

  const shown = list.data?.view === view ? list.data.items : undefined
  const current = views.find((entry) => entry.view === view)!

  const contextName = (id: string) => {
    const context = contexts.find((entry) => entry.id === id)
    if (!context) return 'Unknown context'
    return context.archivedAt ? `${context.name} (archived)` : context.name
  }

  const choose = (next: TaskView) => {
    setSearchParams(next === 'open' ? {} : { view: next }, { replace: true })
    setEditingId(null)
  }

  const act = (work: () => Promise<unknown>) => run(work).then((ok) => ok && list.reload())

  const closeEditor = (changed: boolean) => {
    setEditingId(null)
    if (changed) list.reload()
  }

  const added = () => {
    if (view === 'open') list.reload()
    else choose('open')
  }

  const activeContexts = contexts.filter((context) => !context.archivedAt)
  const rows = shown && view === 'open' ? sortOpen(shown) : shown

  return (
    <div className={styles.column}>
      <QuickAdd contexts={activeContexts} onAdded={added} />

      {error && (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}
      {list.error && (
        <p className={form.error} role="alert">
          {list.error}{' '}
          <button className={styles.inlineButton} type="button" onClick={list.reload}>
            Try again
          </button>
        </p>
      )}

      <GlassPanel as="section" padding="md" aria-label={`${current.label} tasks`}>
        <div className={styles.listHeader}>
          <h2 className={styles.heading}>
            {current.label} <span className={styles.count}>{shown?.length ?? ''}</span>
          </h2>
          <div className={styles.filters} role="group" aria-label="Show tasks">
            {views.map((entry) => (
              <button
                key={entry.view}
                type="button"
                className={cx(styles.filter, entry.view === view && styles.filterActive)}
                aria-pressed={entry.view === view}
                onClick={() => choose(entry.view)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {!rows ? (
          !list.error && <p className={styles.muted}>Loading tasks…</p>
        ) : rows.length > 0 ? (
          <ul className={styles.list}>
            {rows.map((task) =>
              editingId === task.id ? (
                <TaskEditor key={task.id} task={task} contexts={contexts} onClose={closeEditor} />
              ) : (
                <TaskRow
                  key={task.id}
                  task={task}
                  context={contextName(task.contextId)}
                  now={now}
                  busy={busy}
                  onToggle={() => act(() => tasks.setDone(task.id, task.status === 'open'))}
                  onEdit={() => setEditingId(task.id)}
                  onRestore={() => act(() => tasks.setArchived(task.id, false))}
                />
              ),
            )}
          </ul>
        ) : (
          <p className={styles.muted}>{current.empty}</p>
        )}
      </GlassPanel>
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
  now: Date
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onRestore: () => void
}

function TaskRow({ task, context, now, busy, onToggle, onEdit, onRestore }: TaskRowProps) {
  const done = task.status === 'done'
  const archived = Boolean(task.archivedAt)
  const state = deadlineState(task.deadline, now)
  const overdue = state === 'overdue' && !done && !archived
  const firstLine = task.notes?.split('\n').find((line) => line.trim())

  return (
    <li className={styles.row}>
      {!archived && (
        <TaskCheck title={task.title} done={done} disabled={busy} onToggle={onToggle} />
      )}
      <div className={styles.text}>
        <span className={done ? styles.doneTitle : styles.title}>{task.title}</span>
        {firstLine && <span className={styles.notes}>{firstLine}</span>}
        <span className={styles.meta}>
          {context}
          {task.deadline && (
            <>
              {' · '}
              <span className={cx(overdue && styles.overdue, state === 'today' && !done && !archived && styles.dueToday)}>
                {overdue ? 'Overdue · ' : 'Due '}
                {formatDeadline(task.deadline, now)}
              </span>
            </>
          )}
          {done && task.completedAt ? ` · Completed ${formatDayMonth(new Date(task.completedAt))}` : ''}
          {archived && task.archivedAt ? ` · Archived ${formatDayMonth(new Date(task.archivedAt))}` : ''}
          {task.hideFromTv ? ' · Hidden from TV' : ''}
        </span>
      </div>
      {!done && !archived && <PriorityBadge priority={task.priority} />}
      {archived ? (
        <button
          className={styles.textButton}
          type="button"
          disabled={busy}
          onClick={onRestore}
          aria-label={`Restore “${task.title}”`}
        >
          Restore
        </button>
      ) : (
        <button className={styles.textButton} type="button" onClick={onEdit} aria-label={`Edit “${task.title}”`}>
          Edit
        </button>
      )}
    </li>
  )
}
