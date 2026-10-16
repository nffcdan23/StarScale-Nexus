import { version } from '../../../package.json'
import type { NexusEnvironment } from '../../data/environment'
import { formatClock, formatDayMonth } from '../../lib/time'

/** The version in package.json. Only this one value is built into the app. */
export const appVersion: string = version

/** Which database this copy of Nexus uses, in words. Never the full project id. */
export function databaseLabel(environment: NexusEnvironment): string {
  if (environment.kind === 'local') return 'Local Supabase on the Windows PC (development and testing)'
  const ref = environment.projectRef
  return `Supabase Cloud (project ${ref.slice(0, 4)}…${ref.slice(-4)})`
}

export function runsAsLabel(desktop: boolean): string {
  return desktop ? 'Windows desktop app' : 'Web browser'
}

/** For example "16 October 2026, 2:41 PM", in this computer's time. */
export function formatWhen(iso: string): string {
  const date = new Date(iso)
  return `${formatDayMonth(date)} ${date.getFullYear()}, ${formatClock(date)}`
}
