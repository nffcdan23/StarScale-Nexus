import { useId, useState, type FormEvent } from 'react'
import { useData } from '../../app/data/dataContext'
import form from '../../components/Form/Form.module.css'
import { limits, type Context, type Priority, type Task, type TaskChanges } from '../../data/types'
import { deadlineToFields, fieldsToDeadline } from '../../lib/deadlines'
import { useAction } from '../../lib/useAction'
import styles from './TasksPanel.module.css'

const priorities: Array<{ value: Priority; label: string }> = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

interface TaskEditorProps {
  task: Task
  contexts: Context[]
  /** Called when the editor closes; "changed" says whether the task was saved or archived. */
  onClose: (changed: boolean) => void
}

/** Edits one task in place of its row. Only the details that changed are sent. */
export function TaskEditor({ task, contexts, onClose }: TaskEditorProps) {
  const { tasks } = useData()
  const { busy, error, run } = useAction()
  const id = useId()
  const initialDeadline = deadlineToFields(task.deadline)

  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [priority, setPriority] = useState(task.priority)
  const [contextId, setContextId] = useState(task.contextId)
  const [hideFromTv, setHideFromTv] = useState(task.hideFromTv)
  const [date, setDate] = useState(initialDeadline.date)
  const [time, setTime] = useState(initialDeadline.time)

  // An archived context stays listed only if the task is already in it.
  const contextChoices = contexts.filter((context) => !context.archivedAt || context.id === task.contextId)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const saved = await run(async () => {
      const changes: TaskChanges = {}
      if (title !== task.title) changes.title = title
      if (notes !== (task.notes ?? '')) changes.notes = notes
      if (priority !== task.priority) changes.priority = priority
      if (contextId !== task.contextId) changes.contextId = contextId
      if (hideFromTv !== task.hideFromTv) changes.hideFromTv = hideFromTv
      if (date !== initialDeadline.date || time !== initialDeadline.time) changes.deadline = fieldsToDeadline({ date, time })
      if (Object.keys(changes).length > 0) await tasks.update(task.id, changes)
    })
    if (saved) onClose(true)
  }

  const archive = async () => {
    if (await run(() => tasks.setArchived(task.id, true))) onClose(true)
  }

  const clearDeadline = () => {
    setDate('')
    setTime('')
  }

  return (
    <li className={styles.editor}>
      <form className={styles.editorForm} onSubmit={save} aria-label={`Edit “${task.title}”`}>
        <div className={form.field}>
          <label className={form.label} htmlFor={`${id}-title`}>
            Title
          </label>
          <input
            id={`${id}-title`}
            className={form.input}
            maxLength={limits.taskTitle}
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className={form.field}>
          <label className={form.label} htmlFor={`${id}-notes`}>
            Notes
          </label>
          <textarea
            id={`${id}-notes`}
            className={`${form.input} ${styles.notesInput}`}
            maxLength={limits.taskNotes}
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <div className={styles.editorRow}>
          <div className={form.field}>
            <label className={form.label} htmlFor={`${id}-priority`}>
              Priority
            </label>
            <select
              id={`${id}-priority`}
              className={`${form.input} ${styles.select}`}
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              {priorities.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={form.field}>
            <label className={form.label} htmlFor={`${id}-context`}>
              Context
            </label>
            <select
              id={`${id}-context`}
              className={`${form.input} ${styles.select}`}
              value={contextId}
              onChange={(event) => setContextId(event.target.value)}
            >
              {contextChoices.map((context) => (
                <option key={context.id} value={context.id}>
                  {context.archivedAt ? `${context.name} (archived)` : context.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className={styles.deadline}>
          <legend className={form.label}>Deadline</legend>
          <div className={styles.editorRow}>
            <input
              type="date"
              className={`${form.input} ${styles.dateInput}`}
              aria-label="Deadline date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <input
              type="time"
              className={`${form.input} ${styles.dateInput}`}
              aria-label="Deadline time"
              value={time}
              disabled={!date}
              onChange={(event) => setTime(event.target.value)}
            />
            {date && (
              <button className={styles.textButton} type="button" onClick={clearDeadline}>
                Clear deadline
              </button>
            )}
          </div>
          <p className={styles.hint}>Leave the time empty for a deadline that lasts all day.</p>
        </fieldset>

        <label className={form.switch}>
          <input
            type="checkbox"
            role="switch"
            checked={hideFromTv}
            onChange={(event) => setHideFromTv(event.target.checked)}
          />
          Hide from TV
        </label>

        {error && (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.editorActions}>
          <button className={styles.saveButton} type="submit" disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className={styles.textButton} type="button" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button className={`${styles.textButton} ${styles.pushRight}`} type="button" disabled={busy} onClick={archive}>
            Archive task
          </button>
        </div>
      </form>
    </li>
  )
}
