// The checks that run against a REAL Supabase database, shared by the local
// stack (real/run-real.mjs) and the cloud project (cloud/run-cloud.mjs), and
// how their results are recorded.

import { writeFile } from 'node:fs/promises'
import { runApiChecks } from '../real/api-checks.mjs'
import { runCases } from './run-cases.mjs'

/**
 * REAL-01, every access check, then the sign-in and Data API checks. Results
 * are pushed into the given list as they come, so a run that stops early
 * still records what it did.
 *
 * db: { exec, query } on the database as its administrator (postgres).
 * config: { apiUrl, publishableKey, secretKey }.
 */
export async function runRealChecks(db, config, suite, results) {
  // Every migration's main object must exist; add one line per new migration.
  const applied = await db.query(
    `select to_regclass('public.tasks') is not null
        and to_regprocedure('public.tv_summary()') is not null
        and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'tasks' and column_name = 'due_on')
        and pg_get_functiondef('public.tv_summary()'::regprocedure) like '%''due_on''%'
        and to_regclass('public.notes') is not null
        and to_regprocedure('public.search_notes(text, boolean, uuid)') is not null
      as ok`,
  )
  results.push({
    id: 'REAL-01',
    status: applied.rows[0].ok ? 'passed' : 'failed',
    detail: applied.rows[0].ok ? '' : 'a migration is missing: check tasks, tasks.due_on, that tv_summary returns due_on, notes and search_notes',
  })

  // The same access checks as the simulated run, now against Supabase's own
  // roles, default permissions and auth functions.
  results.push(...(await runCases(db, suite)))
  results.push(...(await runApiChecks(config, db)))
}

/**
 * Writes a results file. Every expected check ends up as passed, failed or
 * not executed: a check that never ran is never left showing an older
 * result. Returns { passed, failed, notExecuted, total }.
 */
export async function recordResults(path, { label, fingerprint, expectedIds, results, aborted, extra = {} }) {
  const recorded = new Set(results.map((result) => result.id))
  for (const id of expectedIds) {
    if (!recorded.has(id)) {
      results.push({ id, status: 'not-executed', detail: aborted ? `run stopped: ${aborted}` : 'not run' })
    }
  }

  await writeFile(
    path,
    `${JSON.stringify(
      {
        fingerprint,
        ranOn: new Date().toISOString().slice(0, 10),
        system: process.platform,
        ...extra,
        ...(aborted ? { aborted } : {}),
        results: results.map(({ id, status, detail }) => ({ id, status, detail })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  if (aborted) console.log(`${label} run stopped early: ${aborted}`)
  for (const result of results.filter((entry) => entry.status !== 'passed')) {
    const word = result.status === 'failed' ? 'FAILED' : 'NOT EXECUTED'
    console.log(`${word} on ${label} ${result.id}: ${result.detail}`)
  }

  const count = (status) => results.filter((entry) => entry.status === status).length
  return {
    passed: count('passed'),
    failed: count('failed'),
    notExecuted: count('not-executed'),
    total: expectedIds.length,
  }
}
