import { dayLabel, londonClock, londonDate } from '../../lib/dashboard'

/** When a note was edited: "2:30 PM" today, otherwise "Yesterday" or for example "Tue 13 Oct". London days. */
export function editedLabel(iso: string, now: Date): string {
  const when = new Date(iso)
  const day = londonDate(when)
  const today = londonDate(now)
  return day === today ? londonClock(when) : dayLabel(day, today)
}
