import { CalendarCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useData } from '../../app/data/dataContext'
import form from '../../components/Form/Form.module.css'
import { PriorityBadge } from '../../components/PriorityBadge/PriorityBadge'
import { TaskCheck } from '../../components/TaskCheck/TaskCheck'
import type { Task } from '../../data/types'
import { cx } from '../../lib/cx'
import { deadlineLabel, isOverdue, type TodayTasks } from '../../lib/dashboard'
import { useAction } from '../../lib/useAction'
import { DashboardCard } from './DashboardCard'
import styles from './Dashboard.module.css'

/** How many tasks the card shows before pointing to the Tasks page. */
const SHOWN = 5

interface TodayCardProps {
  today: TodayTasks | undefined
  now: Date
  contextName: (id: string) => string
  /** Called after a task is completed, to load the dashboard again. */
  onChanged: () => Promise<void>
}

/** Overdue tasks first, then what is due today, each with a checkbox to complete it. */
export function TodayCard({ today, now, contextName, onChanged }: TodayCardProps) {
  const { tasks } = useData()
  const { busy, error, run } = useAction()
  // The task being completed shows as ticked until the dashboard reloads without it.
  const [completing, setCompleting] = useState<string | null>(null)

  const complete = async (task: Task) => {
    setCompleting(task.id)
    if (await run(() => tasks.setDone(task.id, true))) await onChanged()
    setCompleting(null)
  }

  const all = today ? [...today.overdue, ...today.dueToday] : []
  const shown = all.slice(0, SHOWN)
  const hidden = all.length - shown.length

  let subtitle: string | undefined
  if (today) {
    const parts = []
    if (today.overdue.length > 0) parts.push(`${today.overdue.length} overdue`)
    if (today.dueToday.length > 0) parts.push(`${today.dueToday.length} due today`)
    subtitle = parts.length > 0 ? parts.join(' · ') : 'Nothing due'
  }

  return (
    <DashboardCard
      icon={CalendarCheck}
      title="Today"
      subtitle={subtitle}
      link={{ to: '/tasks', label: 'View all', name: 'View all open tasks' }}
    >
      {error && (
        <p className={cx(form.error, styles.cardMessage)} role="alert">
          {error}
        </p>
      )}
      {!today ? (
        <p className={styles.muted}>Loading…</p>
      ) : shown.length === 0 ? (
        <p className={styles.muted}>Nothing overdue or due today.</p>
      ) : (
        <ul className={styles.rows}>
          {shown.map((task) => {
            const overdue = isOverdue(task.deadline, now)
            return (
              <li key={task.id} className={styles.row}>
                <TaskCheck
                  title={task.title}
                  done={completing === task.id}
                  disabled={busy}
                  onToggle={() => void complete(task)}
                />
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>{task.title}</span>
                  <span className={styles.rowMeta}>
                    {contextName(task.contextId)}
                    {task.deadline && (
                      <>
                        {' · '}
                        <span className={overdue ? styles.overdue : styles.dueToday}>
                          {overdue ? 'Overdue · ' : 'Due '}
                          {deadlineLabel(task.deadline, now)}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                <PriorityBadge priority={task.priority} />
              </li>
            )
          })}
        </ul>
      )}
      {hidden > 0 && (
        <Link to="/tasks" className={styles.more}>
          {hidden} more in Tasks
        </Link>
      )}
    </DashboardCard>
  )
}
