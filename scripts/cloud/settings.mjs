// NEXUS-ADMIN-ONLY: which Supabase Cloud project the Windows tools work on,
// and how they reach it. Never imported by the app.
//
// The settings file, .env.cloud.local (never committed), holds only values
// that are not secret: the project id, the publishable key and the session
// pooler address. Everything else is worked out from the project id, so the
// tools can only ever reach that one project:
//   API address  https://<project id>.supabase.co
//   database     user postgres.<project id> through the session pooler, which
//                routes by that user name, over TLS verified with the
//                Supabase certificate saved as supabase-ca.crt.
// The database password and the secret key are never stored: they are typed
// into a hidden prompt each time (prompt.mjs).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

export const SETTINGS_FILE = '.env.cloud.local'
export const CA_FILE = 'supabase-ca.crt'

const PROJECT_REF = /^[a-z0-9]{20}$/
// The session pooler (port 5432), for example aws-0-eu-west-2.pooler.supabase.com.
const POOLER_HOST = /^aws-\d+-[a-z]{2}-[a-z]+-\d+\.pooler\.supabase\.com$/

/** A problem the owner should read: the message is plain English. */
export class CloudProblem extends Error {}

/**
 * Checks the cloud settings and returns everything the tools need to reach
 * exactly one project. Throws a CloudProblem naming the setting to fix.
 */
export function cloudSettings(env, { caText, caPath = null }) {
  const projectRef = (env.NEXUS_CLOUD_PROJECT_REF ?? '').trim()
  const publishableKey = (env.NEXUS_CLOUD_PUBLISHABLE_KEY ?? '').trim()
  const dbHost = (env.NEXUS_CLOUD_DB_HOST ?? '').trim()

  const missing = [
    ['NEXUS_CLOUD_PROJECT_REF', projectRef],
    ['NEXUS_CLOUD_PUBLISHABLE_KEY', publishableKey],
    ['NEXUS_CLOUD_DB_HOST', dbHost],
  ].filter(([, value]) => !value)
  if (missing.length > 0) {
    throw new CloudProblem(`${SETTINGS_FILE} is missing: ${missing.map(([name]) => name).join(', ')}. See .env.cloud.example.`)
  }

  if (!PROJECT_REF.test(projectRef)) {
    throw new CloudProblem(
      'NEXUS_CLOUD_PROJECT_REF must be the 20-character project id (Project Settings → General → Project ID), nothing else.',
    )
  }
  if (publishableKey.startsWith('sb_secret_')) {
    throw new CloudProblem(
      `${SETTINGS_FILE} contains a SECRET key. Remove it from the file now, then delete that key in the dashboard ` +
        '(Project Settings → API Keys) and create a new one. Only the publishable key belongs in the file.',
    )
  }
  if (publishableKey.startsWith('eyJ')) {
    throw new CloudProblem(
      'NEXUS_CLOUD_PUBLISHABLE_KEY looks like an old-style anon or service_role key. Use the publishable key (sb_publishable_...).',
    )
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new CloudProblem('NEXUS_CLOUD_PUBLISHABLE_KEY must be the publishable key, which starts sb_publishable_.')
  }
  if (!POOLER_HOST.test(dbHost)) {
    throw new CloudProblem(
      'NEXUS_CLOUD_DB_HOST must be the session pooler host only, for example aws-0-eu-west-2.pooler.supabase.com ' +
        '(Connect → Session pooler). Not a full connection string, and not the direct db.<project>.supabase.co address.',
    )
  }
  if (!caText) {
    throw new CloudProblem(
      `${CA_FILE} is missing. Download the certificate (Project Settings → Database → SSL Configuration) and save it ` +
        `in the project folder as ${CA_FILE}.`,
    )
  }
  if (!caText.includes('-----BEGIN CERTIFICATE-----')) {
    throw new CloudProblem(`${CA_FILE} is not a certificate. Download it again from Project Settings → Database → SSL Configuration.`)
  }

  return {
    projectRef,
    apiUrl: `https://${projectRef}.supabase.co`,
    publishableKey,
    db: { host: dbHost, port: 5432, user: `postgres.${projectRef}`, database: 'postgres' },
    ca: caText,
    caPath,
  }
}

/**
 * The Supabase tool's `db push` for this project: the database address
 * without the password, which travels in the child process's environment
 * instead, so it never appears in a command line or on screen. TLS must be
 * verified with the downloaded certificate. Never --include-seed or
 * --include-all.
 */
export function pushCommand(settings, password, { dryRun }) {
  const { host, port, user, database } = settings.db
  return {
    args: ['db', 'push', '--db-url', `postgresql://${user}@${host}:${port}/${database}`, ...(dryRun ? ['--dry-run'] : [])],
    env: { PGPASSWORD: password, PGSSLMODE: 'verify-full', PGSSLROOTCERT: settings.caPath },
  }
}

/** Reads .env.cloud.local and supabase-ca.crt from the project folder, without changing the environment. */
export function loadCloudSettings(projectRoot) {
  const file = join(projectRoot, SETTINGS_FILE)
  if (!existsSync(file)) {
    throw new CloudProblem(`${SETTINGS_FILE} is missing. Copy .env.cloud.example to ${SETTINGS_FILE} and fill it in.`)
  }
  const caPath = join(projectRoot, CA_FILE)
  const caText = existsSync(caPath) ? readFileSync(caPath, 'utf8') : ''
  return cloudSettings(parseEnv(readFileSync(file, 'utf8')), { caText, caPath })
}

/** For example "abcd…qrst": enough to tell projects apart in a committed report. */
export function shortRef(projectRef) {
  return `${projectRef.slice(0, 4)}…${projectRef.slice(-4)}`
}

/** Replaces every secret in a message with [hidden], so no error can print one. */
export function redact(text, secrets) {
  let result = String(text)
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue
    for (const form of new Set([secret, encodeURIComponent(secret)])) result = result.split(form).join('[hidden]')
  }
  return result
}
