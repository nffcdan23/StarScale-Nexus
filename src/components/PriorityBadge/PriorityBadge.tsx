import type { Priority } from '../../data/types'
import { cx } from '../../lib/cx'
import styles from './PriorityBadge.module.css'

const labels: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' }

/** The High / Medium / Low pill from the reference designs. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={cx(styles.badge, styles[priority])}>{labels[priority]}</span>
}
