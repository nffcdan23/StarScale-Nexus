import type { Deadline } from '../data/types'
import { formatClock } from './time'

// Deadlines are either a calendar day ("2026-10-17") or an exact moment.
// Days are compared as plain dates in this device's time zone, so a task due
// on Friday is due on Friday wherever the owner is; moments are shown in local
// time.

const pad = (value: number) => String(value).padStart(2, '0')

/** The calendar day of a moment in this device's time zone, for example "2026-10-14". */
export function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The start of a stored calendar day, in local time. */
export function dateFromLocalString(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** What the date and time boxes in the task editor hold. An empty time means date-only. */
export interface DeadlineFields {
  date: string
  time: string
}

export function deadlineToFields(deadline: Deadline): DeadlineFields {
  if (!deadline) return { date: '', time: '' }
  if (deadline.kind === 'date') return { date: deadline.date, time: '' }
  const at = new Date(deadline.at)
  return { date: localDateString(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` }
}

/** Turns the editor's boxes into a deadline: none, a date only, or a local date and time. */
export function fieldsToDeadline({ date, time }: DeadlineFields): Deadline {
  if (!date) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(dateFromLocalString(date).getTime())) {
    throw new Error('Enter a valid deadline date.')
  }
  if (!time) return { kind: 'date', date }
  const at = new Date(`${date}T${time}`)
  if (!/^\d{2}:\d{2}$/.test(time) || Number.isNaN(at.getTime())) throw new Error('Enter a valid deadline time.')
  return { kind: 'time', at: at.toISOString() }
}

export type DeadlineState = 'overdue' | 'today' | 'upcoming'

/** Overdue once the day has passed (date-only) or the moment has passed (timed). */
export function deadlineState(deadline: Deadline, now: Date): DeadlineState | null {
  if (!deadline) return null
  const today = localDateString(now)
  if (deadline.kind === 'date') {
    if (deadline.date < today) return 'overdue'
    return deadline.date === today ? 'today' : 'upcoming'
  }
  const at = new Date(deadline.at)
  if (at.getTime() < now.getTime()) return 'overdue'
  return localDateString(at) === today ? 'today' : 'upcoming'
}

const weekdayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short' })

/** "Today", "Tomorrow", "Yesterday", or for example "Fri 17 Oct" (with the year if not this year). */
function dayLabel(day: Date, now: Date): string {
  const offset = (days: number) =>
    localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
  const value = localDateString(day)
  if (value === offset(0)) return 'Today'
  if (value === offset(1)) return 'Tomorrow'
  if (value === offset(-1)) return 'Yesterday'
  const label = `${weekdayFormat.format(day)} ${day.getDate()} ${monthFormat.format(day)}`
  return day.getFullYear() === now.getFullYear() ? label : `${label} ${day.getFullYear()}`
}

/** For example "Tomorrow" or "Fri 17 Oct, 9:00 AM". */
export function formatDeadline(deadline: NonNullable<Deadline>, now: Date): string {
  if (deadline.kind === 'date') return dayLabel(dateFromLocalString(deadline.date), now)
  const at = new Date(deadline.at)
  return `${dayLabel(at, now)}, ${formatClock(at)}`
}
