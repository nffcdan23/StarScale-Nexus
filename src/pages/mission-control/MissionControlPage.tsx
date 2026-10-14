import { useCallback, useEffect, useId } from 'react'
import { useAuth } from '../../app/auth/authContext'
import { brand } from '../../app/brand'
import { useData } from '../../app/data/dataContext'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import { NexusMark } from '../../components/NexusMark/NexusMark'
import { ContextProgressCard } from '../../features/dashboard/ContextProgressCard'
import { NextUpCard } from '../../features/dashboard/NextUpCard'
import { TodayCard } from '../../features/dashboard/TodayCard'
import {
  contextProgress,
  dailySummary,
  londonClock,
  nextSevenDays,
  startOfLondonWeek,
  todayTasks,
} from '../../lib/dashboard'
import { formatClock, formatLongDate, greetingFor } from '../../lib/time'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { REFRESH_INTERVAL, useLiveData } from '../../lib/useLiveData'
import { useMinuteClock } from '../../lib/useMinuteClock'
import styles from './MissionControlPage.module.css'

/** Data on screen older than this is marked as possibly out of date, even without an error. */
const STALE_AFTER = REFRESH_INTERVAL * 4

export function MissionControlPage() {
  useDocumentTitle('Mission Control')
  const now = useMinuteClock()
  const headlineId = useId()
  const { contexts, tasks } = useData()
  const { actions } = useAuth()

  const load = useCallback(async () => {
    const [allContexts, open, doneThisWeek] = await Promise.all([
      contexts.list({ includeArchived: true }),
      tasks.list('open'),
      tasks.completedSince(startOfLondonWeek(new Date())),
    ])
    return { contexts: allContexts, open, doneThisWeek }
  }, [contexts, tasks])
  const live = useLiveData(load)

  // A refusal usually means the sign-in has ended (for example while the
  // computer slept). Check it: if it has, the app returns to sign-in and says so.
  const refused = live.error?.kind === 'refused'
  useEffect(() => {
    if (refused) void actions.recheck()
  }, [refused, live.updatedAt, actions])

  const data = live.data
  const today = data && todayTasks(data.open, now)
  const summary = data && today && dailySummary(today, data.open.length, data.doneThisWeek.length)
  const contextName = (id: string) => {
    const context = data?.contexts.find((entry) => entry.id === id)
    if (!context) return 'Unknown context'
    return context.archivedAt ? `${context.name} (archived)` : context.name
  }

  const updatedAt = live.updatedAt
  const outdated = Boolean(updatedAt && (live.error || now.getTime() - updatedAt.getTime() > STALE_AFTER))

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

      {/* The Nexus briefing banner will take this place later. */}
      <GlassPanel as="section" padding="none" className={styles.hero} aria-labelledby={headlineId}>
        <div className={styles.heroTop}>
          <p className={styles.eyebrow}>
            <NexusMark className={styles.eyebrowMark} />
            {brand.name}
          </p>
          {updatedAt && <p className={styles.updated}>Updated {londonClock(updatedAt)}</p>}
        </div>

        {data && summary ? (
          <>
            <h2 id={headlineId} className={styles.headline}>
              {summary.headline}
            </h2>
            <p className={styles.support}>{summary.detail}</p>
          </>
        ) : live.error ? (
          <>
            <h2 id={headlineId} className={styles.headline}>
              Mission Control could not load your tasks.
            </h2>
            <p className={styles.support}>{live.error.message}</p>
            <button className={styles.retry} type="button" onClick={() => void live.refresh()}>
              Try again
            </button>
          </>
        ) : (
          <h2 id={headlineId} className={styles.headline}>
            Loading your day…
          </h2>
        )}
      </GlassPanel>

      {outdated && updatedAt && (
        <p className={styles.outdated} role="status">
          {live.error?.kind === 'offline'
            ? 'Nexus cannot reach the database.'
            : live.error?.kind === 'refused'
              ? 'Nexus is checking your sign-in.'
              : live.error
                ? 'The last refresh did not work.'
                : 'Updating.'}{' '}
          This shows information from {londonClock(updatedAt)} and may be out of date. Nexus keeps trying every 30
          seconds.{' '}
          <button className={styles.inlineButton} type="button" onClick={() => void live.refresh()}>
            Try now
          </button>
        </p>
      )}

      {(data || !live.error) && (
        <div className={styles.cards}>
          <TodayCard today={today} now={now} contextName={contextName} onChanged={live.refresh} />
          <NextUpCard days={data && nextSevenDays(data.open, now)} contextName={contextName} />
          <ContextProgressCard rows={data && contextProgress(data.contexts, data.open, data.doneThisWeek)} />
        </div>
      )}
    </div>
  )
}
