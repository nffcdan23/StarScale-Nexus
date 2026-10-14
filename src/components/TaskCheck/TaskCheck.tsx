import styles from './TaskCheck.module.css'

interface TaskCheckProps {
  title: string
  done: boolean
  disabled?: boolean
  onToggle: () => void
}

/** Completes or reopens a task. Named after the task, so screen readers say which. */
export function TaskCheck({ title, done, disabled = false, onToggle }: TaskCheckProps) {
  return (
    <input
      type="checkbox"
      className={styles.check}
      checked={done}
      disabled={disabled}
      onChange={onToggle}
      aria-label={done ? `Reopen “${title}”` : `Complete “${title}”`}
    />
  )
}
