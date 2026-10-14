import { ArrowRight, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import styles from './Dashboard.module.css'

interface DashboardCardProps {
  icon: LucideIcon
  title: string
  subtitle?: string
  /** Where "View all" goes, and what it is called for screen readers. */
  link: { to: string; label: string; name: string }
  children: ReactNode
}

/** A Mission Control card, after the Today / Next / Projects cards in the reference design. */
export function DashboardCard({ icon: Icon, title, subtitle, link, children }: DashboardCardProps) {
  const headingId = useId()
  return (
    <GlassPanel as="section" padding="none" className={styles.card} aria-labelledby={headingId}>
      <header className={styles.cardHeader}>
        <Icon className={styles.cardIcon} aria-hidden="true" />
        <div className={styles.cardTitles}>
          <h2 id={headingId} className={styles.cardTitle}>
            {title}
          </h2>
          {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
        </div>
        <Link to={link.to} className={styles.viewAll} aria-label={link.name}>
          {link.label}
          <ArrowRight className={styles.viewAllArrow} aria-hidden="true" />
        </Link>
      </header>
      {children}
    </GlassPanel>
  )
}
