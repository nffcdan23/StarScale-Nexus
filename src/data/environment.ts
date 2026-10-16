/**
 * Which Nexus database a build connects to, worked out from its Supabase
 * address alone, so it can never disagree with where the app actually goes:
 *   local  the Supabase stack on the Windows PC (development and testing);
 *   cloud  the Supabase Cloud project (everyday use), named by its id.
 * Sign-in sessions and note drafts are filed separately for each, so nothing
 * made against one database is ever offered to the other.
 */
export type NexusEnvironment = { kind: 'local' } | { kind: 'cloud'; projectRef: string }

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):54321$/
const CLOUD = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/

/** The environment for a Supabase address, or null if it is neither the local stack nor a cloud project. */
export function environmentOf(url: string): NexusEnvironment | null {
  const address = url.trim().replace(/\/$/, '')
  if (LOCAL.test(address)) return { kind: 'local' }
  const cloud = CLOUD.exec(address)
  return cloud ? { kind: 'cloud', projectRef: cloud[1] } : null
}

/**
 * The environment this build was made for. A build without a usable address
 * cannot sign in at all; it is treated as local so that it never touches
 * anything filed for a cloud project.
 */
export const currentEnvironment: NexusEnvironment = environmentOf(String(import.meta.env.VITE_SUPABASE_URL ?? '')) ?? {
  kind: 'local',
}

/**
 * Where the sign-in session is kept in the browser: the name Supabase's own
 * library would choose ("sb-127-auth-token" for the local stack,
 * "sb-<project id>-auth-token" for the cloud), stated here so the two can
 * never share one.
 */
export function authStorageKey(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
}
