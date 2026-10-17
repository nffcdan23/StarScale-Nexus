// Runs the Nexus security checks and writes docs/security-report.md.
//
//   npm run test:security         Simulated checks only (PGlite). Works anywhere.
//   npm run test:security:real    Also runs against a real local Supabase stack.
//   npm run test:security:cloud   Also runs against the empty cloud project
//                                 (Windows PC only; see docs/cloud-setup.md).
//   npm run test:security:cloud-live
//                                 Also checks the cloud project in use, changing
//                                 nothing (Windows PC only; docs/cloud-setup.md).
//
// Writes docs/security-report.md (simulated and local) and
// docs/cloud-security-report.md (cloud) every time.
//
// Exits with an error if anything that was executed failed.

import { cases, cloudLiveCases, cloudOnlyCases, realOnlyCases } from './lib/cases.mjs'
import { identities, seedSql } from './lib/fixtures.mjs'
import { fingerprint, loadMigrations } from './lib/migrations.mjs'
import { mutate, mutations } from './lib/mutations.mjs'
import { reportPath } from './lib/paths.mjs'
import {
  buildCloudReport,
  buildReport,
  cloudReportPath,
  loadCloudLiveResults,
  loadCloudResults,
  loadRealResults,
  writeReport,
} from './lib/report.mjs'
import { runCases } from './lib/run-cases.mjs'
import { runStaticChecks } from './lib/static-checks.mjs'
import { createMockDatabase } from './mock/pglite-database.mjs'

const targets = { '--target=real': 'real', '--target=cloud': 'cloud', '--target=cloud-live': 'cloud-live' }
const target = targets[process.argv.slice(2).find((arg) => arg in targets)] ?? 'mock'
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

let realCounts = null
let realStartError = null
if (target === 'real') {
  // Loaded only when asked for, so the simulated run needs nothing extra installed.
  const { runReal } = await import('./real/run-real.mjs')
  const expectedIds = [...cases.map((testCase) => testCase.id), ...realOnlyCases.map((testCase) => testCase.id)]
  try {
    realCounts = await runReal({ suite, fingerprint: currentFingerprint, expectedIds })
  } catch (error) {
    realStartError = error.message
  }
}
const realFailed = target === 'real' && (realStartError !== null || realCounts.failed > 0 || realCounts.notExecuted > 0)

let cloudCounts = null
let cloudStartError = null
if (target === 'cloud') {
  // Loaded only when asked for: Windows PC only.
  const { runCloud } = await import('./cloud/run-cloud.mjs')
  const expectedIds = [...cases, ...realOnlyCases, ...cloudOnlyCases].map((testCase) => testCase.id)
  const migrationVersions = migrations.map((migration) => migration.name.split('_')[0])
  try {
    cloudCounts = await runCloud({ suite, fingerprint: currentFingerprint, expectedIds, migrationVersions })
  } catch (error) {
    cloudStartError = error.message
  }
}
if (target === 'cloud-live') {
  // Loaded only when asked for: Windows PC only.
  const { runCloudLive } = await import('./cloud/run-cloud-live.mjs')
  const expectedIds = [...cases.map((testCase) => testCase.id), 'REAL-01', ...cloudLiveCases.map((testCase) => testCase.id)]
  const migrationVersions = migrations.map((migration) => migration.name.split('_')[0])
  try {
    cloudCounts = await runCloudLive({ suite, fingerprint: currentFingerprint, expectedIds, migrationVersions })
  } catch (error) {
    cloudStartError = error.message
  }
}
const cloudTarget = target === 'cloud' || target === 'cloud-live'
const cloudFailed = cloudTarget && (cloudStartError !== null || cloudCounts.failed > 0 || cloudCounts.notExecuted > 0)

const real = await loadRealResults()
await writeReport(
  buildReport({ fingerprint: currentFingerprint, applyResult, staticResults, mockResults, selfTests, realOnlyCases, real }),
)
await writeReport(
  buildCloudReport({
    fingerprint: currentFingerprint,
    mockResults,
    realOnlyCases,
    cloudOnlyCases,
    cloudLiveCases,
    cloud: await loadCloudResults(),
    live: await loadCloudLiveResults(),
  }),
  cloudReportPath,
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
if (target === 'mock') {
  console.log(`Real Supabase checks: not executed in this run (${realOnlyCases.length} can only run on real Supabase)`)
} else if (cloudTarget) {
  console.log('Local real Supabase checks: not run (this run was for the cloud project; local results are unchanged)')
} else if (realStartError) {
  console.log(`Real Supabase checks: NOT STARTED, nothing was run: ${realStartError}`)
} else {
  console.log(
    `Real Supabase checks: ${realCounts.passed} passed, ${realCounts.failed} failed, ` +
      `${realCounts.notExecuted} not executed, of ${realCounts.total}`,
  )
}
if (cloudTarget) {
  const which = target === 'cloud' ? 'Cloud project checks (full run)' : 'Cloud project checks (in use)'
  console.log(
    cloudStartError
      ? `${which}: NOT STARTED: ${cloudStartError}`
      : `${which}: ${cloudCounts.passed} passed, ${cloudCounts.failed} failed, ` +
          `${cloudCounts.notExecuted} not executed, of ${cloudCounts.total}`,
  )
}
for (const failure of failures) console.log(`FAILED ${failure.id}: ${failure.detail}`)
console.log(`Reports: ${reportPath} and ${cloudReportPath}`)
if (target === 'mock') {
  console.log('Simulated passes are not proof that real Supabase security works.')
}

process.exitCode = failures.length > 0 || realFailed || cloudFailed ? 1 : 0
