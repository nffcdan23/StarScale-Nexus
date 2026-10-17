// Runs the security checks against the CLOUD project (Phase 3c-4b-2).
//
//   npm run test:security:cloud        Windows PC only
//
// Before anything is touched, the run stops unless:
//   * .env.cloud.local names exactly one project, and its publishable key and
//     the typed secret key are both accepted by that project;
//   * the database is reached over an encrypted connection verified with
//     supabase-ca.crt, with the typed database password;
//   * every migration is already applied (npm run cloud:migrate) and the
//     project is empty: no accounts, sign-ins, contexts, tasks or notes;
//   * the owner types the project id.
//
// Then it runs every access check (each in a transaction that is undone),
// the sign-in and Data API checks (two temporary test sign-ins, created by
// this run and deleted by it at the end, with their made-up records), the
// structure comparison with the local database, and the restore drill with
// fictional data (undone). Last, it checks the project is empty again; it
// never deletes anything else. Results go to cloud/results.json, separate
// from the local results.

import {
  checkKeys,
  connectCloud,
  describeContents,
  isEmpty,
  judgeAuthSettings,
  migrationPlan,
  readProjectState,
} from '../../../scripts/cloud/project.mjs'
import { askDatabasePassword, askSecretKey, confirmProject } from '../../../scripts/cloud/prompt.mjs'
import { CloudProblem, loadCloudSettings, redact, shortRef } from '../../../scripts/cloud/settings.mjs'
import { requireWindows } from '../../../tools/windows/windows-only.mjs'
import { cloudResultsPath, projectRoot } from '../lib/paths.mjs'
import { recordResults, runRealChecks } from '../lib/real-checks.mjs'
import { drillCheck, structureCheck } from './shared.mjs'

/**
 * Runs every cloud check and records the outcome. Problems found before the
 * owner confirms throw, leaving the previous results file alone.
 * Returns { passed, failed, notExecuted, total }.
 */
export async function runCloud({ suite, fingerprint, expectedIds, migrationVersions }) {
  requireWindows('This cloud check')
  const settings = loadCloudSettings(projectRoot)
  console.log(`\nCloud project: ${settings.projectRef} (${settings.apiUrl})`)

  // Before any secret is typed: the publishable key must belong to this project.
  const authSettings = await checkKeys(settings)
  const password = await askDatabasePassword()
  const secretKey = await askSecretKey()
  const secrets = [password, secretKey]
  await checkKeys(settings, { secretKey })

  const db = await connectCloud(settings, password, { readOnly: false })
  let state
  try {
    state = await readProjectState(db)
    const plan = migrationPlan(state.applied, migrationVersions)
    if (plan.problem) throw new CloudProblem(`nothing was run: ${plan.problem}`)
    if (plan.pending.length > 0) {
      throw new CloudProblem(`nothing was run: ${plan.pending.length} migrations are not applied yet. Run npm run cloud:migrate first.`)
    }
    if (!isEmpty(state)) {
      throw new CloudProblem(`nothing was run: the project is not empty (${describeContents(state.counts)}). These checks run only on an empty project.`)
    }
    console.log(
      [
        '',
        `Connected: PostgreSQL ${state.version}, all ${migrationVersions.length} migrations applied, project empty.`,
        'The checks will now:',
        '  - run every access check inside transactions that are undone;',
        '  - create two temporary test sign-ins (emails starting nexus-test-) with made-up records,',
        '    and delete them at the end;',
        '  - compare the database structure with your local database (read-only);',
        '  - restore a fictional backup inside a transaction that is undone.',
        'No real data is used. Nothing else is created, changed or deleted.',
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
    results.push({ id: 'CLOUD-01', status: 'passed', detail: `keys accepted by ${shortRef(settings.projectRef)}; TLS verified` })
    const authProblems = judgeAuthSettings(authSettings)
    results.push({ id: 'CLOUD-02', status: authProblems.length === 0 ? 'passed' : 'failed', detail: authProblems.join('; ') })
    results.push({ id: 'CLOUD-03', status: 'passed', detail: `${migrationVersions.length} of ${migrationVersions.length} applied in order` })
    results.push(await structureCheck(db, state.version))
    await runRealChecks(db, { apiUrl: settings.apiUrl, publishableKey: settings.publishableKey, secretKey }, suite, results)
    results.push(await drillCheck(db))
  } catch (error) {
    aborted = error.message
  }

  // Whatever happened above: is the project empty again? Nothing is deleted here.
  try {
    const after = await readProjectState(db)
    results.push(
      isEmpty(after)
        ? { id: 'CLOUD-06', status: 'passed', detail: '' }
        : {
            id: 'CLOUD-06',
            status: 'failed',
            detail:
              `left behind: ${describeContents(after.counts)}. Nothing is deleted automatically. Remove leftover test ` +
              'sign-ins (emails starting nexus-test-) in the dashboard under Authentication → Users, then run the checks again.',
          },
    )
  } catch (error) {
    results.push({ id: 'CLOUD-06', status: 'not-executed', detail: `could not read the project: ${error.message}` })
  } finally {
    await db.close().catch(() => {})
  }

  for (const result of results) result.detail = redact(result.detail ?? '', secrets)
  return recordResults(cloudResultsPath, {
    label: 'the cloud project',
    fingerprint,
    expectedIds,
    results,
    aborted: aborted ? redact(aborted, secrets) : null,
    extra: { project: shortRef(settings.projectRef), postgres: state.version },
  })
}
