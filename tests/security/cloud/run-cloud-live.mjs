// Runs the security checks against the CLOUD project while it is in use:
// it holds your accounts and records (Phase 4a).
//
//   npm run test:security:cloud-live        Windows PC only
//
// Before anything is touched, the run stops unless .env.cloud.local names
// exactly one project whose publishable key it accepts, the database is
// reached over an encrypted connection verified with supabase-ca.crt, every
// migration is applied, and the owner types the project id. Only the
// database password is needed: no secret key, and no accounts are created.
//
// Safeguards for the existing information:
//   * every access check and the restore drill run inside transactions that
//     are always rolled back; nothing they write is ever kept;
//   * the restore drill uses fictional records for a stand-in owner that
//     exists only inside its transaction;
//   * a fingerprint of every account, sign-in, context, task and note is
//     taken before and after; any difference fails LIVE-06. Close Nexus on
//     every device while the checks run, or your own edits would show up.
// Results go to cloud/live-results.json, separate from the full run.

import {
  checkKeys,
  connectCloud,
  describeContents,
  fingerprintChanges,
  judgeAuthSettings,
  migrationPlan,
  readDataFingerprint,
  readProjectState,
} from '../../../scripts/cloud/project.mjs'
import { askDatabasePassword, confirmProject } from '../../../scripts/cloud/prompt.mjs'
import { CloudProblem, loadCloudSettings, redact, shortRef } from '../../../scripts/cloud/settings.mjs'
import { requireWindows } from '../../../tools/windows/windows-only.mjs'
import { cloudLiveResultsPath, projectRoot } from '../lib/paths.mjs'
import { migrationsPresent, recordResults } from '../lib/real-checks.mjs'
import { runCases } from '../lib/run-cases.mjs'
import { drillCheck, structureCheck } from './shared.mjs'

/**
 * Runs the checks for a project in use and records the outcome. Problems
 * found before the owner confirms throw, leaving the previous results alone.
 * Returns { passed, failed, notExecuted, total }.
 */
export async function runCloudLive({ suite, fingerprint, expectedIds, migrationVersions }) {
  requireWindows('This cloud check')
  const settings = loadCloudSettings(projectRoot)
  console.log(`\nCloud project (in use): ${settings.projectRef} (${settings.apiUrl})`)

  const authSettings = await checkKeys(settings)
  const password = await askDatabasePassword()
  const secrets = [password]
  const db = await connectCloud(settings, password, { readOnly: false })

  let state
  let before
  try {
    state = await readProjectState(db)
    const plan = migrationPlan(state.applied, migrationVersions)
    if (plan.problem) throw new CloudProblem(`nothing was run: ${plan.problem}`)
    if (plan.pending.length > 0) {
      throw new CloudProblem(`nothing was run: ${plan.pending.length} migrations are not applied yet. Run npm run cloud:migrate first.`)
    }
    before = await readDataFingerprint(db)
    console.log(
      [
        '',
        `Connected: PostgreSQL ${state.version}, all ${migrationVersions.length} migrations applied.`,
        `The project holds ${describeContents(state.counts)}.`,
        'The checks will now:',
        '  - run every access check inside transactions that are always undone;',
        '  - compare the database structure with your local database (read-only);',
        '  - restore a fictional backup for a stand-in owner, inside a transaction that is undone;',
        '  - confirm afterwards that every existing record is exactly as it was.',
        'No accounts are created. Close Nexus on every device until the checks finish.',
        '',
      ].join('\n'),
    )
    if (!(await confirmProject(settings.projectRef))) throw new CloudProblem('stopped by you. Nothing was changed.')
  } catch (error) {
    await db.close()
    throw new CloudProblem(redact(error.message, secrets))
  }

  const results = []
  let aborted = null
  try {
    results.push({ id: 'LIVE-01', status: 'passed', detail: `publishable key accepted by ${shortRef(settings.projectRef)}; TLS verified` })
    const authProblems = judgeAuthSettings(authSettings)
    results.push({ id: 'LIVE-02', status: authProblems.length === 0 ? 'passed' : 'failed', detail: authProblems.join('; ') })
    results.push({ id: 'LIVE-03', status: 'passed', detail: `${migrationVersions.length} of ${migrationVersions.length} applied in order` })
    results.push({ ...(await structureCheck(db, state.version)), id: 'LIVE-04' })
    results.push(await migrationsPresent(db))
    results.push(...(await runCases(db, suite)))
    results.push({ ...(await drillCheck(db)), id: 'LIVE-05' })
  } catch (error) {
    aborted = error.message
  }

  // Whatever happened above: is everything exactly as it was? Nothing is changed here.
  try {
    const changes = fingerprintChanges(before, await readDataFingerprint(db))
    results.push(
      changes.length === 0
        ? { id: 'LIVE-06', status: 'passed', detail: describeContents({ ...state.counts }) }
        : {
            id: 'LIVE-06',
            status: 'failed',
            detail:
              `different after the checks: ${changes.join('; ')}. If Nexus was open somewhere, that edit would show here; ` +
              'otherwise stop and report this. Nothing is changed or deleted automatically.',
          },
    )
  } catch (error) {
    results.push({ id: 'LIVE-06', status: 'not-executed', detail: `could not read the project: ${error.message}` })
  } finally {
    await db.close().catch(() => {})
  }

  for (const result of results) result.detail = redact(result.detail ?? '', secrets)
  return recordResults(cloudLiveResultsPath, {
    label: 'the cloud project (in use)',
    fingerprint,
    expectedIds,
    results,
    aborted: aborted ? redact(aborted, secrets) : null,
    extra: { project: shortRef(settings.projectRef), postgres: state.version, mode: 'in use' },
  })
}
