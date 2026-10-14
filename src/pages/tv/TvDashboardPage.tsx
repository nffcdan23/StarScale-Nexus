import { useCallback, useEffect, useId, type ReactNode } from 'react'
import { useAuth } from '../../app/auth/authContext'
import { brand } from '../../app/brand'
import { useData } from '../../app/data/dataContext'
import { Backdrop } from '../../components/Backdrop/Backdrop'
import { GlassPanel } from '../../components/GlassPanel/GlassPanel'
import { NexusMark } from '../../components/NexusMark/NexusMark'
import { PriorityBadge } from '../../components/PriorityBadge/PriorityBadge'
import type { TvTask } from '../../data/types'
import { cx } from '../../lib/cx'
import { dailySummary, deadlineLabel, isOverdue, londonClock, nextSevenDays, todayTasks } from '../../lib/dashboard'
import { formatClock, formatDayMonth, formatWeekday, greetingFor } from '../../lib/time'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { REFRESH_INTERVAL, useLiveData } from '../../lib/useLiveData'
import { useMinuteClock } from '../../lib/useMinuteClock'
import { TvSettingsMenu } from './TvSettingsMenu'
import styles from './TvDashboardPage.module.css'

/** Rows per panel: few enough to read from across a room. */
const ROWS = 4
/** The database never sends more than this many tasks to the TV. */
const SUMMARY_LIMIT = 50
/** Information older than this is marked as out of date, even without an error. */
const STALE_AFTER = REFRESH_INTERVAL * 4

/**
 * Mission Control for the television: a passive, full-screen display read
 * from across the room. Everything shown comes from the database's redacted
 * TV summary (titles, contexts, priorities and deadlines of tasks approved
 * for the TV); this page never reads tasks or contexts directly. The only
 * control is the discreet settings menu. Every size is a multiple of
 * --tv-unit, so the layout scales with the screen.
 */
export function TvDashboardPage() {
  useDocumentTitle('Mission Control TV')
  const now = useMinuteClock()
  const { summary } = useData()
  const { actions } = useAuth()

  const live = useLiveData(useCallback(() => summary.get(), [summary]))

  // A refusal usually means the sign-in has ended. Check it: if it has, the
  // app shows the sign-in screen with "Your session has ended".
  const refused = live.error?.kind === 'refused'
  useEffect(() => {
    if (refused) void actions.recheck()
  }, [refused, live.updatedAt, actions])

  const tasks = live.data?.tasks
  const today = tasks && todayTasks(tasks, now)
  const upcoming = tasks && nextSevenDays(tasks, now).flatMap((day) => day.tasks.map((task) => ({ day, task })))

  let headline: string
  if (tasks && today) headline = tasks.length > 0 ? dailySummary(today, tasks.length, 0).headline : 'Nothing to show on the TV right now.'
  else if (live.error) headline = 'The TV cannot load its summary yet. It will keep trying.'
  else headline = 'Loading…'

  const updatedAt = live.updatedAt
  const outdated = Boolean(updatedAt && (live.error || now.getTime() - updatedAt.getTime() > STALE_AFTER))

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
      <GlassPanel as="section" surface="tint" padding="none" className={styles.hero} aria-label="Summary">
        <div>
          <p className={styles.eyebrow}>
            <NexusMark className={styles.mark} />
            {brand.name}
          </p>
          <p className={styles.greeting}>{greetingFor(now)}.</p>
          <p className={styles.summary}>{headline}</p>
        </div>
        <div className={styles.aside}>
          <p className={styles.tagline}>{brand.tagline}</p>
          <p className={styles.signature}>{brand.signature}</p>
        </div>
      </GlassPanel>

      {tasks && today && upcoming && tasks.length > 0 ? (
        <div className={styles.panels}>
          <TvPanel title="Today" more={today.overdue.length + today.dueToday.length - ROWS}>
            {[...today.overdue, ...today.dueToday].slice(0, ROWS).map((task, index) => {
              const overdue = isOverdue(task.deadline, now)
              return (
                <li key={index} className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowTitle}>{task.title}</span>
                    <span className={styles.rowMeta}>
                      {task.context}
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
                  <PriorityBadge priority={task.priority} className={styles.badge} />
                </li>
              )
            })}
            {today.overdue.length + today.dueToday.length === 0 && <Empty>Nothing overdue or due today.</Empty>}
          </TvPanel>

          <TvPanel title="Next Up" more={upcoming.length - ROWS}>
            {upcoming.slice(0, ROWS).map(({ day, task }, index) => (
              <li key={index} className={styles.row}>
                <span className={styles.when}>
                  <span>{day.label}</span>
                  <span className={styles.whenTime}>
                    {task.deadline?.kind === 'time' ? londonClock(new Date(task.deadline.at)) : 'All day'}
                  </span>
                </span>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>{task.title}</span>
                  <span className={styles.rowMeta}>{task.context}</span>
                </div>
              </li>
            ))}
            {upcoming.length === 0 && <Empty>No deadlines in the next seven days.</Empty>}
          </TvPanel>

          <ContextsPanel tasks={tasks} />
        </div>
      ) : (
        <div />
      )}

      <footer className={styles.bottom}>
        <p className={cx(styles.status, outdated && styles.stale)} role="status">
          {updatedAt
            ? outdated
              ? `${live.error?.kind === 'offline' ? 'Offline. ' : ''}Showing information from ${londonClock(updatedAt)}; it may be out of date.`
              : `Updated ${londonClock(updatedAt)}`
            : ''}
        </p>
        <TvSettingsMenu onRefresh={() => void live.refresh()} onSignOut={() => void actions.signOut()} />
      </footer>
    </div>
  )
}

function TvPanel({ title, more, children }: { title: string; more: number; children: ReactNode }) {
  const headingId = useId()
  return (
    <GlassPanel as="section" surface="tint" padding="none" className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.panelHeader}>
        <h2 id={headingId} className={styles.panelTitle}>
          {title}
        </h2>
        {more > 0 && <p className={styles.more}>and {more} more</p>}
      </div>
      <ul className={styles.rows}>{children}</ul>
    </GlassPanel>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <li className={styles.empty}>{children}</li>
}

/** Open task counts per context, counted from the TV summary itself. */
function ContextsPanel({ tasks }: { tasks: TvTask[] }) {
  const counts = new Map<string, number>()
  for (const task of tasks) counts.set(task.context, (counts.get(task.context) ?? 0) + 1)
  const rows = [...counts].sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB))

  return (
    <TvPanel title="Open by context" more={rows.length - ROWS}>
      {rows.slice(0, ROWS).map(([name, count]) => (
        <li key={name} className={styles.row}>
          <span className={styles.rowTitle}>{name}</span>
          <span className={styles.count}>{count}</span>
        </li>
      ))}
      {tasks.length >= SUMMARY_LIMIT && (
        <li className={styles.empty}>Counts cover the first {SUMMARY_LIMIT} tasks.</li>
      )}
    </TvPanel>
  )
}
