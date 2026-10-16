// NEXUS-ADMIN-ONLY: shows the state of the cloud project. Changes nothing.
// Never imported by the app.
//
//   npm run cloud:status        Windows PC only
//
// Checks the settings name exactly one project and its publishable key is
// accepted there, asks for the database password (hidden), connects over a
// verified encrypted connection in read-only mode, and reports the
// PostgreSQL version, which migrations are applied, what the project holds
// and whether its sign-in settings match supabase/config.toml.

import { loadMigrations } from '../../tests/security/lib/migrations.mjs'
import { projectRoot, requireWindows } from '../../tools/windows/windows-only.mjs'
import {
  checkKeys,
  connectCloud,
  describeContents,
  isEmpty,
  judgeAuthSettings,
  migrationPlan,
  readProjectState,
} from './project.mjs'
import { askDatabasePassword } from './prompt.mjs'
import { CloudProblem, loadCloudSettings } from './settings.mjs'

function stop(message) {
  console.error(`\nStopped: ${message}\n`)
  process.exit(1)
}

try {
  requireWindows('This command')
} catch (error) {
  stop(error.message)
}

try {
  const settings = loadCloudSettings(projectRoot)
  const versions = (await loadMigrations()).map((migration) => migration.name.split('_')[0])

  console.log(`\nStarScale Nexus cloud project (read-only check)`)
  console.log(`Project: ${settings.projectRef}  ${settings.apiUrl}`)
  console.log(`Database: ${settings.db.user} at ${settings.db.host} (session pooler)`)

  const authSettings = await checkKeys(settings)
  console.log('Publishable key: accepted by this project.')
  const authProblems = judgeAuthSettings(authSettings)

  const password = await askDatabasePassword()
  const db = await connectCloud(settings, password, { readOnly: true })
  try {
    console.log('Connection: encrypted, certificate verified, read-only.')
    const state = await readProjectState(db)
    const plan = migrationPlan(state.applied, versions)

    console.log(`PostgreSQL: ${state.version}${state.majorVersion === 17 ? '' : '  (the local stack uses 17: the structure check will show any difference)'}`)
    if (plan.problem) console.log(`Migrations: PROBLEM: ${plan.problem}. Do not apply anything; report this.`)
    else if (plan.pending.length === 0) console.log(`Migrations: all ${versions.length} applied.`)
    else console.log(`Migrations: ${state.applied.length} of ${versions.length} applied. Not yet applied: ${plan.pending.join(', ')}`)
    console.log(`Contents: ${describeContents(state.counts)}${isEmpty(state) ? ' (empty)' : ''}`)
    console.log(
      authProblems.length === 0
        ? 'Sign-in settings: sign-ups off, email and password only.'
        : `Sign-in settings: FIX IN THE DASHBOARD: ${authProblems.join('; ')}`,
    )
    console.log('\nNothing was changed.\n')
  } finally {
    await db.close()
  }
} catch (error) {
  stop(error instanceof CloudProblem ? error.message : `something went wrong: ${error.message}`)
}
