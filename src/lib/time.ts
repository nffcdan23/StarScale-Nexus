export type Greeting = 'Good morning' | 'Good afternoon' | 'Good evening'

/** Morning runs 05:00 to 11:59, afternoon 12:00 to 17:59, evening the rest. */
export function greetingFor(date: Date): Greeting {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** 12-hour clock as shown in the designs, for example "8:42 PM". */
export function formatClock(date: Date): string {
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}

const weekdayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long' })
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long' })

export function formatWeekday(date: Date): string {
  return weekdayFormat.format(date)
}

/** British order, for example "13 October". */
export function formatDayMonth(date: Date): string {
  return `${date.getDate()} ${monthFormat.format(date)}`
}

/**
 * For example "Tuesday 13 October 2026". Assembled by hand because browsers
 * disagree on the punctuation of a fully formatted British date.
 */
export function formatLongDate(date: Date): string {
  return `${formatWeekday(date)} ${formatDayMonth(date)} ${date.getFullYear()}`
}
