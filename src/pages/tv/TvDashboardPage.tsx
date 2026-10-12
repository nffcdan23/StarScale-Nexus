import { brand } from '../../app/brand'
import { Backdrop } from '../../components/Backdrop/Backdrop'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import { NexusMark } from '../../components/NexusMark/NexusMark'
import { formatClock, formatDayMonth, formatWeekday, greetingFor } from '../../lib/time'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useMinuteClock } from '../../lib/useMinuteClock'
import styles from './TvDashboardPage.module.css'

/**
 * Mission Control for the television: a passive, full-screen display read
 * from across the room. Nothing here is clickable, by design. Every size is
 * a multiple of --tv-unit, so the layout scales with the screen.
 */
export function TvDashboardPage() {
  useDocumentTitle('Mission Control TV')
  const now = useMinuteClock()

  return (
    <div className={styles.tv}>
      <Backdrop variant="tv" />
      <h1 className="visually-hidden">Mission Control</h1>

      <header className={styles.top}>
        <div>
          <p className={styles.weekday}>{formatWeekday(now)}</p>
          <p className={styles.date}>{formatDayMonth(now)}</p>
        </div>
        <time className={styles.clock} dateTime={now.toISOString()}>
          {formatClock(now)}
        </time>
      </header>

      {/* Tinted rather than blurred: live blur is costly on a page that runs
          all day, and looks the same over a still backdrop. */}
      <GlassPanel as="section" surface="tint" padding="none" className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            <NexusMark className={styles.mark} />
            {brand.name}
          </p>
          <p className={styles.greeting}>{greetingFor(now)}.</p>
          <p className={styles.summary}>Nothing needs your attention yet.</p>
        </div>
        <div className={styles.aside}>
          <p className={styles.tagline}>{brand.tagline}</p>
          <p className={styles.signature}>{brand.signature}</p>
        </div>
      </GlassPanel>
    </div>
  )
}
