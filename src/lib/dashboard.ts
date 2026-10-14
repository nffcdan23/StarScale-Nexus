import type { Context, Deadline, Priority, Task } from '../data/types'

// The calculations behind Mission Control. Every day boundary is a London
// calendar day, whatever time zone the computer is set to, matching the TV
// summary in the database. Every figure is an exact count; nothing here is
// an estimate.

const LONDON = 'Europe/London'

const londonFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function londonParts(date: Date) {
  const parts = Object.fromEntries(londonFormat.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The London calendar day of a moment, for example "2026-10-14". */
export function londonDate(date: Date): string {
  const { year, month, day } = londonParts(date)
  return `${year}-${pad(month)}-${pad(day)}`
}

/** A calendar day moved by whole days, for example addDays("2026-10-31", 1) is "2026-11-01". */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const moved = new Date(Date.UTC(year, month - 1, date + days))
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`
}

/** The moment a London calendar day begins. */
function londonMidnight(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  const guess = Date.UTC(year, month - 1, date)
  const wall = londonParts(new Date(guess))
  const offset = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - guess
  return new Date(guess - offset)
}

/** Monday 00:00 London time at the start of the current week. */
export function startOfLondonWeek(now: Date): Date {
  const today = londonDate(now)
  const [year, month, date] = today.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay() // 0 is Sunday
  return londonMidnight(addDays(today, -((weekday + 6) % 7)))
}

/** The London day a deadline falls on, or null for none. */
export function deadlineDay(deadline: Deadline): string | null {
  if (!deadline) return null
  return deadline.kind === 'date' ? deadline.date : londonDate(new Date(deadline.at))
}

/** 12-hour London time, for example "9:00 AM". */
export function londonClock(date: Date): string {
  const { hour, minute } = londonParts(date)
  return `${hour % 12 || 12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`
}

const weekdayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })

/** "Today", "Tomorrow", "Yesterday", or for example "Fri 17 Oct" (with the year if not this year). */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === addDays(today, 1)) return 'Tomorrow'
  if (day === addDays(today, -1)) return 'Yesterday'
  const [year, month, date] = day.split('-').map(Number)
  const noon = new Date(Date.UTC(year, month - 1, date, 12))
  const label = `${weekdayFormat.format(noon)} ${date} ${monthFormat.format(noon)}`
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${year}`
}

/** For example "Yesterday" or "Today, 5:00 PM". */
export function deadlineLabel(deadline: NonNullable<Deadline>, now: Date): string {
  const label = dayLabel(deadlineDay(deadline)!, londonDate(now))
  return deadline.kind === 'date' ? label : `${label}, ${londonClock(new Date(deadline.at))}`
}

/** Passed: a date-only deadline before today, or a timed deadline whose moment has gone. */
export function isOverdue(deadline: Deadline, now: Date): boolean {
  if (!deadline) return false
  if (deadline.kind === 'date') return deadline.date < londonDate(now)
  return Date.parse(deadline.at) < now.getTime()
}

/** Anything with a deadline and a priority: a task, or a task in the TV summary. */
interface Scheduled {
  deadline: Deadline
  priority: Priority
  createdAt?: string
}

const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
// TV summary tasks carry no creation time; the sort keeps their database order.
const byAge = (a: Scheduled, b: Scheduled) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
const timeOf = (deadline: Deadline) => (deadline?.kind === 'time' ? Date.parse(deadline.at) : -Infinity)

/** Earliest deadline day first, then priority, then time (all-day first), then oldest. Same as the TV summary. */
export function byDeadlineThenPriority(a: Scheduled, b: Scheduled): number {
  const dayA = deadlineDay(a.deadline) ?? '9999-12-31'
  const dayB = deadlineDay(b.deadline) ?? '9999-12-31'
  if (dayA !== dayB) return dayA < dayB ? -1 : 1
  return (
    priorityRank[a.priority] - priorityRank[b.priority] ||
    timeOf(a.deadline) - timeOf(b.deadline) ||
    byAge(a, b)
  )
}

/** For a timeline: all-day first, then by time, then priority. */
function byTimeThenPriority(a: Scheduled, b: Scheduled): number {
  return (
    timeOf(a.deadline) - timeOf(b.deadline) ||
    priorityRank[a.priority] - priorityRank[b.priority] ||
    byAge(a, b)
  )
}

export interface TodayTasks<T extends Scheduled = Task> {
  /** Open tasks whose deadline has passed. */
  overdue: T[]
  /** Open tasks due later today (London), including date-only tasks due today. */
  dueToday: T[]
}

export function todayTasks<T extends Scheduled>(open: T[], now: Date): TodayTasks<T> {
  const today = londonDate(now)
  const overdue = open.filter((task) => isOverdue(task.deadline, now))
  const dueToday = open.filter((task) => !isOverdue(task.deadline, now) && deadlineDay(task.deadline) === today)
  return { overdue: overdue.sort(byDeadlineThenPriority), dueToday: dueToday.sort(byDeadlineThenPriority) }
}

export interface UpcomingDay<T extends Scheduled = Task> {
  day: string
  label: string
  tasks: T[]
}

/** Open tasks due on each of the next seven London days after today, days with nothing left out. */
export function nextSevenDays<T extends Scheduled>(open: T[], now: Date): UpcomingDay<T>[] {
  const today = londonDate(now)
  const days: UpcomingDay<T>[] = []
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = addDays(today, offset)
    const tasks = open.filter((task) => deadlineDay(task.deadline) === day).sort(byTimeThenPriority)
    if (tasks.length > 0) days.push({ day, label: dayLabel(day, today), tasks })
  }
  return days
}

export interface ContextProgress {
  id: string
  name: string
  archived: boolean
  /** Open tasks in this context now (not archived). */
  open: number
  /** Tasks completed since Monday 00:00 London time, still completed and not archived. */
  doneThisWeek: number
}

/**
 * One row per context with open tasks or completions this week, in the
 * contexts' own order. Archived contexts appear only if they still have some.
 */
export function contextProgress(contexts: Context[], open: Task[], doneThisWeek: Task[]): ContextProgress[] {
  return contexts
    .map((context) => ({
      id: context.id,
      name: context.name,
      archived: Boolean(context.archivedAt),
      open: open.filter((task) => task.contextId === context.id).length,
      doneThisWeek: doneThisWeek.filter((task) => task.contextId === context.id).length,
    }))
    .filter((row) => row.open > 0 || row.doneThisWeek > 0)
}

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`

/** The greeting panel's two lines, built only from counts. */
export function dailySummary(today: TodayTasks<Scheduled>, openCount: number, doneThisWeekCount: number) {
  const overdue = today.overdue.length
  const due = today.dueToday.length
  let headline: string
  if (overdue > 0 && due > 0) headline = `${count(overdue, 'overdue task', 'overdue tasks')} and ${due} due today.`
  else if (overdue > 0) headline = `${count(overdue, 'overdue task', 'overdue tasks')}.`
  else if (due > 0) headline = `${count(due, 'task', 'tasks')} due today.`
  else headline = openCount > 0 ? 'Nothing due today.' : 'No open tasks.'

  const detail = `${count(openCount, 'open task', 'open tasks')} in total, and ${count(doneThisWeekCount, 'task', 'tasks')} completed since Monday.`
  return { headline, detail }
}
