// NEXUS-ADMIN-ONLY: the rules for creating sign-ins in the cloud project and
// changing their passwords. Never imported by the app. Tested on any
// computer with fictional accounts and fake services; the command itself is
// account.mjs.

import { cloudVerification } from '../../tests/security/lib/report.mjs'
import { CloudProblem, shortRef } from './settings.mjs'

export const USAGE =
  'use: npm run cloud:account -- owner --email ADDRESS | tv --email ADDRESS | password --email ADDRESS | list'

/**
 * The command and email address, or { problem }. A password is never taken
 * from the command line: the password command asks for it, hidden.
 */
export function parseAccountArguments(argv) {
  const [command, ...rest] = argv
  if (command === 'list' && rest.length === 0) return { command }
  if (['owner', 'tv', 'password'].includes(command) && rest.length === 2 && rest[0] === '--email') {
    return { command, email: rest[1] }
  }
  return { problem: USAGE }
}

/** The registered Nexus sign-in with this email address, or null. */
export function findSignIn(registered, email) {
  const address = (email ?? '').trim().toLowerCase()
  return registered.find((entry) => entry.email === address) ?? null
}

/**
 * Why a new password cannot be used, or null. At least 12 characters; at most
 * 72 bytes, the most Supabase accepts; no spaces at either end, which are
 * easy to paste by mistake and impossible to see in a hidden prompt.
 */
export function newPasswordProblem(password) {
  if (password.length < 12) return 'The new password must be at least 12 characters long.'
  if (new TextEncoder().encode(password).length > 72) return 'The new password is too long (Supabase accepts at most 72 bytes).'
  if (password !== password.trim()) return 'The new password starts or ends with a space. Type it again without one.'
  return null
}

/**
 * Sets a new password on an existing sign-in through Supabase's Auth admin
 * API (the same call as auth.admin.updateUserById). Only the password is
 * sent: the account's id, email, role and authenticator are left as they
 * are. The password is never part of any message.
 */
export async function setPassword({ settings, secretKey, userId, password, fetchImpl = fetch }) {
  let response
  try {
    response = await fetchImpl(`${settings.apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
  } catch (error) {
    throw new CloudProblem(`Could not reach ${settings.apiUrl} (${error.cause?.code ?? 'network error'}). The password was not changed.`)
  }
  let data = null
  try {
    data = await response.json()
  } catch {
    // Some replies have no body.
  }
  if (!response.ok) {
    const code = data?.error_code ?? data?.code
    const reasons = Array.isArray(data?.weak_password?.reasons) ? ` (${data.weak_password.reasons.join(', ')})` : ''
    const message = typeof data?.msg === 'string' ? `: ${data.msg}` : ''
    throw new CloudProblem(
      `Supabase did not change the password (status ${response.status}${code ? `, ${code}` : ''}${message}${reasons}). The old password still works.`,
    )
  }
  if (data?.id !== userId) {
    throw new CloudProblem('Supabase replied about a different account. Check the account in the dashboard before signing in.')
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Why the cloud project must not be given accounts yet, or null if it is
 * verified for these migrations: by the full run on the empty project, or
 * by the check on the project in use together with an earlier full run
 * (see cloudVerification in tests/security/lib/report.mjs).
 * runs: { cloud, live } as recorded in tests/security/cloud/.
 */
export function verificationProblem({ cloud, live }, { fingerprint, projectRef, ids }) {
  if (!cloud) {
    return 'the cloud security checks have not been recorded (tests/security/cloud/results.json is missing). Run npm run test:security:cloud first.'
  }
  const status = cloudVerification({ fingerprint, ids, cloud, live })
  if (status.verified && status.project !== shortRef(projectRef)) {
    return `the recorded cloud checks are for project ${status.project}, not ${shortRef(projectRef)}.`
  }
  if (!status.verified) {
    return 'the recorded cloud checks did not all pass for the current migrations. Run npm run test:security:cloud-live and see docs/cloud-security-report.md.'
  }
  return null
}

/**
 * Whether a new sign-in may be created. Nexus has exactly one owner; a TV
 * always shows that owner's summary. registered lists the Nexus sign-ins
 * ({ userId, kind, email }); accounts counts every sign-in account in the
 * project, registered or not.
 * Returns { problem } or { ownerId } (the owner a TV belongs to; null for an owner).
 */
export function accountPlan(role, { email, registered, accounts }) {
  const address = (email ?? '').trim().toLowerCase()
  if (!EMAIL.test(address)) return { problem: 'give a valid --email address.' }
  if (accounts !== registered.length) {
    return {
      problem:
        'the project has sign-in accounts that are not Nexus sign-ins (for example left over from a test run). ' +
        'Check Authentication → Users in the dashboard and remove them first. Nothing was created.',
    }
  }
  if (registered.some((entry) => entry.email === address)) return { problem: `${address} already has a Nexus sign-in.` }
  const owners = registered.filter((entry) => entry.kind === 'owner')
  if (role === 'owner') {
    return owners.length > 0
      ? { problem: `the owner sign-in already exists (${owners[0].email}). Nexus has exactly one owner.` }
      : { email: address, ownerId: null }
  }
  if (owners.length !== 1) return { problem: 'create the owner sign-in first: a TV shows the owner’s summary.' }
  return { email: address, ownerId: owners[0].userId }
}
