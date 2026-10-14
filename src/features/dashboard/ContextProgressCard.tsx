import { Layers } from 'lucide-react'
import type { ContextProgress } from '../../lib/dashboard'
import { DashboardCard } from './DashboardCard'
import styles from './Dashboard.module.css'

/**
 * Open tasks and this week's completions for each context. Stands in for the
 * reference design's Projects card until Projects is built. Every figure is
 * an exact count; the bar is done ÷ (done + open), nothing estimated.
 */
export function ContextProgressCard({ rows }: { rows: ContextProgress[] | undefined }) {
  return (
    <DashboardCard
      icon={Layers}
      title="Contexts"
      subtitle="This week, since Monday"
      link={{ to: '/tasks?view=done', label: 'Completed', name: 'View completed tasks' }}
    >
      {!rows ? (
        <p className={styles.muted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>No open tasks and nothing completed this week.</p>
      ) : (
        <>
          <ul className={styles.progressList}>
            {rows.map((row) => {
              const total = row.open + row.doneThisWeek
              return (
                <li key={row.id} className={styles.progressRow}>
                  <div className={styles.progressText}>
                    <span className={styles.rowTitle}>
                      {row.name}
                      {row.archived ? ' (archived)' : ''}
                    </span>
                    <span className={styles.rowMeta}>
                      {row.open} open · {row.doneThisWeek} done this week
                    </span>
                  </div>
                  {/* The counts above say the same in words. */}
                  <div className={styles.bar} aria-hidden="true">
                    <div className={styles.barFill} style={{ width: `${(row.doneThisWeek / total) * 100}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
          <p className={styles.footnote}>
            Bars show tasks completed since Monday out of those plus tasks still open.
          </p>
        </>
      )}
    </DashboardCard>
  )
}
