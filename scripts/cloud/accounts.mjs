// NEXUS-ADMIN-ONLY: the rules for creating sign-ins in the cloud project.
// Never imported by the app. Pure functions, tested on any computer; the
// command itself is account.mjs.

import { shortRef } from './settings.mjs'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Why the cloud project must not be given accounts yet, or null if the
 * recorded cloud security checks (tests/security/cloud/results.json) all
 * passed, for this project and these migrations.
 */
export function verificationProblem(results, { fingerprint, projectRef, expectedIds }) {
  if (!results) {
    return 'the cloud security checks have not been recorded (tests/security/cloud/results.json is missing). Run npm run test:security:cloud first.'
  }
  if (results.project !== shortRef(projectRef)) {
    return `the recorded cloud checks are for project ${results.project}, not ${shortRef(projectRef)}.`
  }
  if (results.fingerprint !== fingerprint) {
    return 'the migrations have changed since the cloud checks were recorded, so the cloud project is not verified for them.'
  }
  const notPassed = expectedIds.filter((id) => results.results?.find((result) => result.id === id)?.status !== 'passed')
  if (notPassed.length > 0) {
    return `not every recorded cloud check passed (${notPassed.slice(0, 5).join(', ')}${notPassed.length > 5 ? ', ...' : ''}).`
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
