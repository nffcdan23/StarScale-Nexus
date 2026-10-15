import { limits, type Note } from '../../data/types'
import { londonClock } from '../../lib/dashboard'
import type { NoteDraft } from './drafts'

const dayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' })

/**
 * The title "Keep both" gives the copy of your version, for example
 * "Plans (my version, 15 Oct, 2:41 PM)". Fixed by the version itself, so a
 * retry produces exactly the same title. Never longer than the title limit.
 */
export function copyTitle(mine: Pick<NoteDraft, 'title' | 'changedAt'>): string {
  const when = new Date(mine.changedAt)
  const suffix = ` (my version, ${dayMonth.format(when)}, ${londonClock(when)})`
  const base = mine.title.trim() || 'Untitled'
  return base.slice(0, limits.noteTitle - suffix.length).trimEnd() + suffix
}

/** Deep equality for saved documents; the database may return object keys in a different order. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => sameValue(item, b[index]))
  const keysA = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined)
  const keysB = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined)
  return (
    keysA.length === keysB.length &&
    keysA.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  )
}

/** True when a local version says exactly what the database already holds: nothing to resolve. */
export function sameAsDatabase(mine: Pick<NoteDraft, 'title' | 'contextId' | 'content'>, latest: Note): boolean {
  return mine.title === latest.title && mine.contextId === latest.contextId && sameValue(mine.content, latest.content)
}
