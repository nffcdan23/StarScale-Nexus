// Runs the security checks against a REAL local Supabase stack.
//
// STATUS: written on a machine without Supabase and never executed. Expect
// to adjust details (connection settings, the made-up sign-in records) the
// first time it runs on the Windows PC.
//
// Before running, on that PC:
//   1. Start the local Supabase stack and apply the migrations to it.
//   2. Install the "pg" package (a PostgreSQL client), with the owner's approval.
//   3. Copy .env.security.example to .env.security.local and fill it in from
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

/** Runs everything, records the results, and returns true if anything failed. */
export async function runReal({ suite, fingerprint }) {
  const config = readConfig()
  const db = await connect(config.dbUrl)
  const results = []

  try {
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
  } finally {
    await db.close()
  }

  await writeFile(
    realResultsPath,
    `${JSON.stringify(
      {
        fingerprint,
        ranOn: new Date().toISOString().slice(0, 10),
        system: process.platform,
        results: results.map(({ id, status, detail }) => ({ id, status, detail })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  for (const result of results.filter((entry) => entry.status === 'failed')) {
    console.log(`FAILED on real Supabase ${result.id}: ${result.detail}`)
  }
  return results.some((entry) => entry.status === 'failed')
}
