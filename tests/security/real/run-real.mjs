// Runs the security checks against a REAL local Supabase stack.
//
// Before running, on the Windows PC:
//   1. Start the local Supabase stack (it applies supabase/migrations and
//      reads supabase/config.toml when it starts).
//   2. Copy .env.security.example to .env.security.local and fill it in from
//      the values the local stack prints when it starts.

import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectRoot, realResultsPath } from '../lib/paths.mjs'
import { runCases } from '../lib/run-cases.mjs'
import { runApiChecks } from './api-checks.mjs'

function readConfig() {
  const envFile = join(projectRoot, '.env.security.local')
  if (existsSync(envFile)) process.loadEnvFile(envFile)

  const config = {
    dbUrl: process.env.NEXUS_TEST_DB_URL,
    apiUrl: process.env.NEXUS_TEST_API_URL?.replace(/\/$/, ''),
    publishableKey: process.env.NEXUS_TEST_PUBLISHABLE_KEY,
    secretKey: process.env.NEXUS_TEST_SECRET_KEY,
  }
  const missing = Object.entries(config).filter(([, value]) => !value).map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(`Missing settings in .env.security.local: ${missing.join(', ')}`)
  }

  // These checks create and delete records. They must never touch a hosted project.
  for (const url of [config.dbUrl, config.apiUrl]) {
    const host = new URL(url).hostname
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      throw new Error(`Refusing to run: ${host} is not this computer. Real checks run only against a local Supabase stack.`)
    }
  }
  return config
}

async function connect(dbUrl) {
  let pg
  try {
    pg = (await import('pg')).default
  } catch {
    throw new Error('The "pg" package is not installed. It is needed only for real Supabase checks.')
  }
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  return {
    exec: (sql) => client.query(sql),
    query: async (sql, params) => {
      const result = await client.query(sql, params)
      return { rows: result.rows, affectedRows: result.rowCount ?? 0 }
    },
    close: () => client.end(),
  }
}

/**
 * Runs every real check and records the outcome. Every expected check ends up
 * as passed, failed or not executed: a check that never ran is never left
 * showing an older result.
 *
 * Returns { passed, failed, notExecuted, total }.
 */
export async function runReal({ suite, fingerprint, expectedIds }) {
  // Problems found here (missing settings, a non-local address) stop the run
  // before anything is touched, and leave the previous results file alone.
  const config = readConfig()

  const results = []
  let aborted = null
  let db = null
  try {
    db = await connect(config.dbUrl)

    const applied = await db.query(
      "select to_regclass('public.tasks') is not null and to_regprocedure('public.tv_summary()') is not null as ok",
    )
    results.push({
      id: 'REAL-01',
      status: applied.rows[0].ok ? 'passed' : 'failed',
      detail: applied.rows[0].ok ? '' : 'the tasks table or tv_summary function is missing',
    })

    // The same access checks as the simulated run, now against Supabase's own
    // roles, default permissions and auth functions.
    results.push(...(await runCases(db, suite)))
    results.push(...(await runApiChecks(config, db)))
  } catch (error) {
    aborted = error.message
  } finally {
    if (db) await db.close()
  }

  const recorded = new Set(results.map((result) => result.id))
  for (const id of expectedIds) {
    if (!recorded.has(id)) {
      results.push({ id, status: 'not-executed', detail: aborted ? `run stopped: ${aborted}` : 'not run' })
    }
  }

  await writeFile(
    realResultsPath,
    `${JSON.stringify(
      {
        fingerprint,
        ranOn: new Date().toISOString().slice(0, 10),
        system: process.platform,
        ...(aborted ? { aborted } : {}),
        results: results.map(({ id, status, detail }) => ({ id, status, detail })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  if (aborted) console.log(`Real run stopped early: ${aborted}`)
  for (const result of results.filter((entry) => entry.status !== 'passed')) {
    const label = result.status === 'failed' ? 'FAILED' : 'NOT EXECUTED'
    console.log(`${label} on real Supabase ${result.id}: ${result.detail}`)
  }

  const count = (status) => results.filter((entry) => entry.status === status).length
  return {
    passed: count('passed'),
    failed: count('failed'),
    notExecuted: count('not-executed'),
    total: expectedIds.length,
  }
}
