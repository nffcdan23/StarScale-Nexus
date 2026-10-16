// NEXUS-ADMIN-ONLY: connecting to the cloud project and reading its state.
// Never imported by the app.
//
// Reading functions take any client with query(sql, params) → { rows }, so
// they are tested on the Mac against throwaway PGlite databases. Only
// connectCloud needs the Windows-only PostgreSQL client.

import { loadPg } from '../../tools/windows/load-pg.mjs'
import { CloudProblem, redact } from './settings.mjs'

const TLS_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
])

/** A connection problem in plain words, with any secret removed. */
export function describeConnectionError(error, settings, secrets) {
  const code = error?.code
  let message
  if (TLS_CODES.has(code)) {
    message =
      `The cloud database's certificate could not be verified with supabase-ca.crt (${code}). ` +
      'The connection was stopped before the password was sent. Download the certificate again ' +
      '(Project Settings → Database → SSL Configuration); if it still fails, stop and report this message.'
  } else if (code === '28P01') {
    message = 'The database password was not accepted. Nothing was changed.'
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    message = `${settings.db.host} could not be found. Check NEXUS_CLOUD_DB_HOST and the internet connection.`
  } else if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    message = `${settings.db.host} did not answer (${code}). Check the internet connection and that the project is not paused.`
  } else if (/tenant or user not found/i.test(String(error?.message))) {
    message =
      'The pooler at that address does not know this project id. Check that NEXUS_CLOUD_DB_HOST is the session ' +
      "pooler shown under Connect for this project (the region must match) and that the project id is right."
  } else {
    message = `Could not connect to the cloud database: ${error?.message ?? error}`
  }
  return new CloudProblem(redact(message, secrets))
}

/**
 * Connects to the cloud project's database through the session pooler, over
 * TLS verified with the Supabase certificate. readOnly makes every
 * transaction in the session read-only, so nothing can be changed.
 */
export async function connectCloud(settings, password, { readOnly }) {
  const pg = loadPg()
  const client = new pg.Client({
    ...settings.db,
    password,
    ssl: { ca: settings.ca, rejectUnauthorized: true, servername: settings.db.host },
    application_name: 'nexus-cloud-tools',
    connectionTimeoutMillis: 20_000,
  })
  try {
    await client.connect()
    if (readOnly) await client.query('set default_transaction_read_only = on')
  } catch (error) {
    await client.end().catch(() => {})
    throw describeConnectionError(error, settings, [password])
  }
  return {
    exec: (sql) => client.query(sql),
    query: async (sql, params) => {
      const result = await client.query(sql, params)
      return { rows: result.rows, affectedRows: result.rowCount ?? 0 }
    },
    close: () => client.end(),
  }
}

async function request(fetchImpl, url, key) {
  try {
    const response = await fetchImpl(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    let body = null
    try {
      body = await response.json()
    } catch {
      // Some refusals have no body.
    }
    return { status: response.status, body }
  } catch (error) {
    throw new CloudProblem(`Could not reach ${new URL(url).origin} (${error.cause?.code ?? error.message}).`)
  }
}

/**
 * Confirms the keys belong to this project: Supabase refuses a key from any
 * other project. Returns the project's public sign-in settings.
 */
export async function checkKeys(settings, { secretKey = null, fetchImpl = fetch } = {}) {
  const publicSettings = await request(fetchImpl, `${settings.apiUrl}/auth/v1/settings`, settings.publishableKey)
  if (publicSettings.status !== 200 || !publicSettings.body) {
    throw new CloudProblem(
      `The publishable key was not accepted by ${settings.apiUrl} (status ${publicSettings.status}). ` +
        'Check NEXUS_CLOUD_PUBLISHABLE_KEY belongs to this project.',
    )
  }
  if (secretKey) {
    const admin = await request(fetchImpl, `${settings.apiUrl}/auth/v1/admin/users?page=1&per_page=1`, secretKey)
    if (admin.status !== 200) {
      throw new CloudProblem(`The secret key was not accepted by ${settings.apiUrl} (status ${admin.status}). Nothing was changed.`)
    }
  }
  return publicSettings.body
}

/** Problems with the project's sign-in settings, compared with supabase/config.toml. Empty when all is well. */
export function judgeAuthSettings(authSettings) {
  const problems = []
  const external = authSettings?.external ?? {}
  if (authSettings?.disable_signup !== true) {
    problems.push('Sign-ups are ON: turn off "Allow new users to sign up" (Authentication → Sign In / Providers)')
  }
  if (external.email !== true) problems.push('Email sign-in is OFF: Nexus signs in with email and password')
  for (const [provider, enabled] of Object.entries(external)) {
    if (provider === 'email' || enabled !== true) continue
    problems.push(
      provider === 'anonymous_users' ? 'Anonymous sign-ins are ON: turn them off' : `${provider} sign-in is ON: turn it off`,
    )
  }
  return problems
}

/**
 * What the cloud database holds: version, applied migrations and how many
 * accounts and records exist. Reads only.
 */
export async function readProjectState(db) {
  const { rows } = await db.query(`
    select current_setting('server_version') as version,
           current_setting('server_version_num')::int as version_num,
           to_regclass('supabase_migrations.schema_migrations') is not null as has_history,
           to_regclass('public.contexts') is not null as has_contexts,
           to_regclass('public.tasks') is not null as has_tasks,
           to_regclass('public.notes') is not null as has_notes,
           to_regclass('private.identities') is not null as has_identities,
           (select count(*)::int from auth.users) as accounts
  `)
  const info = rows[0]
  const count = async (table, present) =>
    present ? Number((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n) : 0
  const applied = info.has_history
    ? (await db.query('select version::text as version from supabase_migrations.schema_migrations order by version')).rows.map(
        (row) => row.version,
      )
    : []
  return {
    version: info.version,
    majorVersion: Math.floor(info.version_num / 10000),
    applied,
    hasNexusTables: info.has_contexts || info.has_tasks || info.has_notes || info.has_identities,
    counts: {
      accounts: info.accounts,
      identities: await count('private.identities', info.has_identities),
      contexts: await count('public.contexts', info.has_contexts),
      tasks: await count('public.tasks', info.has_tasks),
      notes: await count('public.notes', info.has_notes),
    },
  }
}

export function isEmpty(state) {
  return Object.values(state.counts).every((value) => value === 0)
}

export function describeContents(counts) {
  return (
    `${counts.accounts} sign-in accounts, ${counts.identities} registered sign-ins, ` +
    `${counts.contexts} contexts, ${counts.tasks} tasks, ${counts.notes} notes`
  )
}

/**
 * Which repository migrations the cloud database still needs. The cloud
 * history must be the start of the repository's list, in order; anything
 * else means the database was changed outside Nexus, and nothing is applied.
 */
export function migrationPlan(applied, repoVersions) {
  const unknown = applied.filter((version) => !repoVersions.includes(version))
  if (unknown.length > 0) {
    return { problem: `the cloud database has migrations this project does not have: ${unknown.join(', ')}`, pending: [] }
  }
  const inOrder = applied.every((version, index) => repoVersions[index] === version)
  if (!inOrder) {
    return { problem: 'the cloud database has the migrations in a different order or with gaps', pending: [] }
  }
  return { problem: null, pending: repoVersions.slice(applied.length) }
}

const DESTRUCTIVE = [
  [/\bdrop\s+(table|schema|database|view|materialized\s+view)\b/i, 'drops a table, view or schema'],
  [/\balter\s+table\b[^;]*\bdrop\s+column\b/i, 'drops a column'],
  [/\btruncate\b/i, 'empties a table'],
  [/\bdelete\s+from\b/i, 'deletes rows'],
  [/\bupdate\s+[\w."]+\s+set\b/i, 'changes existing rows'],
]

/**
 * Statements in a migration that could remove or change stored data. Text
 * inside comments and inside function bodies is not a statement run by the
 * migration and is ignored.
 */
export function destructiveStatements(sql) {
  const code = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ')
  return DESTRUCTIVE.filter(([pattern]) => pattern.test(code)).map(([, reason]) => reason)
}
