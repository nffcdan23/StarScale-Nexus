// Runs the Nexus security checks and writes docs/security-report.md.
//
//   npm run test:security        Simulated checks only (PGlite). Works anywhere.
//   npm run test:security:real   Also runs against a real local Supabase stack.
//
// Exits with an error if anything that was executed failed.

import { cases, realOnlyCases } from './lib/cases.mjs'
import { identities, seedSql } from './lib/fixtures.mjs'
import { fingerprint, loadMigrations } from './lib/migrations.mjs'
import { mutate, mutations } from './lib/mutations.mjs'
import { reportPath } from './lib/paths.mjs'
import { buildReport, loadRealResults, writeReport } from './lib/report.mjs'
import { runCases } from './lib/run-cases.mjs'
import { runStaticChecks } from './lib/static-checks.mjs'
import { createMockDatabase } from './mock/pglite-database.mjs'

const target = process.argv.includes('--target=real') ? 'real' : 'mock'
const suite = { cases, identities, seedSql }

async function runSimulated(migrations) {
  const db = await createMockDatabase(migrations)
  try {
    return await runCases(db, suite)
  } finally {
    await db.close()
  }
}

async function runSelfTests(migrations) {
  const results = []
  for (const mutation of mutations) {
    try {
      const outcome = await runSimulated(mutate(migrations, mutation))
      const caughtBy = outcome.filter((result) => result.status === 'failed').map((result) => result.id)
      results.push({
        id: mutation.id,
        title: mutation.title,
        caughtBy,
        status: caughtBy.length > 0 ? 'passed' : 'failed',
        detail: caughtBy.length > 0 ? '' : 'every check still passed',
      })
    } catch (error) {
      results.push({ id: mutation.id, title: mutation.title, caughtBy: [], status: 'failed', detail: error.message })
    }
  }
  return results
}

const migrations = await loadMigrations()
const currentFingerprint = fingerprint(migrations)
const staticResults = runStaticChecks(migrations)

let applyResult = { status: 'passed', detail: '' }
let mockResults = []
let selfTests = []
try {
  mockResults = await runSimulated(migrations)
  selfTests = await runSelfTests(migrations)
} catch (error) {
  applyResult = { status: 'failed', detail: error.message }
}

let realFailed = false
if (target === 'real') {
  // Loaded only when asked for, so the simulated run needs nothing extra installed.
  const { runReal } = await import('./real/run-real.mjs')
  realFailed = await runReal({ suite, fingerprint: currentFingerprint })
}

const real = await loadRealResults()
await writeReport(
  buildReport({ fingerprint: currentFingerprint, applyResult, staticResults, mockResults, selfTests, realOnlyCases, real }),
)

const failures = [
  ...(applyResult.status === 'failed' ? [{ id: 'APPLY-01', detail: applyResult.detail }] : []),
  ...staticResults.filter((result) => result.status === 'failed'),
  ...mockResults.filter((result) => result.status === 'failed'),
  ...selfTests.filter((result) => result.status === 'failed'),
]

const passed = (results) => results.filter((result) => result.status === 'passed').length
console.log(`Migrations fingerprint: ${currentFingerprint}`)
console.log(`Migrations apply (PGlite): ${applyResult.status}`)
console.log(`Written rules: ${passed(staticResults)} of ${staticResults.length} passed`)
console.log(`Simulated access checks (PGlite): ${passed(mockResults)} of ${cases.length} passed`)
console.log(`Self-test (removed protections caught): ${passed(selfTests)} of ${mutations.length}`)
console.log(
  target === 'real'
    ? `Real Supabase checks: ${realFailed ? 'FAILED, see the report' : 'passed'}`
    : `Real Supabase checks: not executed in this run (${realOnlyCases.length} need real Supabase)`,
)
for (const failure of failures) console.log(`FAILED ${failure.id}: ${failure.detail}`)
console.log(`Report: ${reportPath}`)
if (target !== 'real') {
  console.log('Simulated passes are not proof that real Supabase security works.')
}

process.exitCode = failures.length > 0 || realFailed ? 1 : 0
