import { useId } from 'react'
import { brand } from '../../app/brand'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import { NexusMark } from '../../components/NexusMark/NexusMark'
import { formatClock, formatLongDate, greetingFor } from '../../lib/time'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useMinuteClock } from '../../lib/useMinuteClock'
import styles from './MissionControlPage.module.css'

export function MissionControlPage() {
  useDocumentTitle('Mission Control')
  const now = useMinuteClock()
  const headlineId = useId()

  return (
    <div className={styles.page}>
      <h1 className="visually-hidden">Mission Control</h1>

      <header className={styles.header}>
        <div>
          <p className={styles.date}>{formatLongDate(now)}</p>
          <p className={styles.greeting}>{greetingFor(now)}.</p>
          <p className={styles.tagline}>{brand.tagline}</p>
        </div>
        <time className={styles.clock} dateTime={now.toISOString()}>
          {formatClock(now)}
        </time>
      </header>

      {/* The Nexus briefing banner takes this place once there is data to brief
          on. The Today, Next and Projects cards follow it as further sections. */}
      <GlassPanel as="section" padding="none" className={styles.hero} aria-labelledby={headlineId}>
        <p className={styles.eyebrow}>
          <NexusMark className={styles.eyebrowMark} />
          {brand.name}
        </p>
        <h2 id={headlineId} className={styles.headline}>
          Nothing needs your attention yet.
        </h2>
        <p className={styles.support}>
          Your priorities, upcoming items and project status will appear here as tasks and projects
          are added.
        </p>
      </GlassPanel>
    </div>
  )
}
