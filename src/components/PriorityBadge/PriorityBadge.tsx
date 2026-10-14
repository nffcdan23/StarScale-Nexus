import type { Priority } from '../../data/types'
import { cx } from '../../lib/cx'
import styles from './PriorityBadge.module.css'

const labels: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' }

/** The High / Medium / Low pill from the reference designs. className can resize it (the TV does). */
export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return <span className={cx(styles.badge, styles[priority], className)}>{labels[priority]}</span>
}
