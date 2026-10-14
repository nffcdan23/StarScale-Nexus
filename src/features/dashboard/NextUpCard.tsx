import { CalendarDays } from 'lucide-react'
import { londonClock, type UpcomingDay } from '../../lib/dashboard'
import { DashboardCard } from './DashboardCard'
import styles from './Dashboard.module.css'

interface NextUpCardProps {
  days: UpcomingDay[] | undefined
  contextName: (id: string) => string
}

/** Deadlines on each of the next seven days, as a timeline like the reference design's "Next" card. */
export function NextUpCard({ days, contextName }: NextUpCardProps) {
  return (
    <DashboardCard
      icon={CalendarDays}
      title="Next Up"
      subtitle="The next seven days"
      link={{ to: '/tasks', label: 'View all', name: 'View all open tasks' }}
    >
      {!days ? (
        <p className={styles.muted}>Loading…</p>
      ) : days.length === 0 ? (
        <p className={styles.muted}>No deadlines in the next seven days.</p>
      ) : (
        <div className={styles.timeline}>
          {days.map((day) => (
            <section key={day.day} aria-label={day.label}>
              <h3 className={styles.dayLabel}>{day.label}</h3>
              <ul className={styles.timelineList}>
                {day.tasks.map((task) => (
                  <li key={task.id} className={styles.timelineItem}>
                    <span className={styles.timelineTime}>
                      {task.deadline?.kind === 'time' ? londonClock(new Date(task.deadline.at)) : 'All day'}
                    </span>
                    <span className={styles.timelineDot} aria-hidden="true" />
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{task.title}</span>
                      <span className={styles.rowMeta}>{contextName(task.contextId)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </DashboardCard>
  )
}
