// NEXUS-ADMIN-ONLY: applies this project's migrations to the cloud project.
// Never imported by the app.
//
//   npm run cloud:migrate       Windows PC only
//
// 1. Checks the settings name exactly one project and its publishable key is
//    accepted there; asks for the database password (hidden); reads the
//    project read-only over a verified encrypted connection.
// 2. Works out which migrations are missing. Stops if the cloud history is
//    not the start of this project's list, if Nexus tables exist without a
//    history, or if a missing migration could remove or change stored data.
// 3. Shows the Supabase tool's own preview (--dry-run: changes nothing).
// 4. Goes ahead only when the owner types the project id. The Supabase tool
//    may list the migrations again and ask Y/n.
// 5. Reads the history again and confirms every migration is applied.
//
// It never resets anything, never adds seed data and never applies a
// migration out of order. It adds tables, functions and access rules only;
// it creates no accounts and adds no records.

import { spawnSync } from 'node:child_process'
import { loadMigrations } from '../../tests/security/lib/migrations.mjs'
import { supabaseEntry } from '../../tools/windows/supabase-cli.mjs'
import { projectRoot, requireWindows } from '../../tools/windows/windows-only.mjs'
import { checkKeys, connectCloud, destructiveStatements, migrationPlan, readProjectState } from './project.mjs'
import { askDatabasePassword, confirmProject } from './prompt.mjs'
import { CloudProblem, loadCloudSettings, pushCommand } from './settings.mjs'

function stop(message) {
  console.error(`\nStopped: ${message}\n`)
  process.exit(1)
}

async function readState(settings, password) {
  const db = await connectCloud(settings, password, { readOnly: true })
  try {
    return await readProjectState(db)
  } finally {
    await db.close()
  }
}

function runSupabase(entry, settings, password, { dryRun }) {
  const { args, env } = pushCommand(settings, password, { dryRun })
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  return result.status === 0
}

try {
  requireWindows('This command')
} catch (error) {
  stop(error.message)
}

try {
  const settings = loadCloudSettings(projectRoot)
  const entry = supabaseEntry()
  if (!entry) throw new CloudProblem('the Supabase tool is not installed yet. Run: npm run setup:windows')
  const migrations = await loadMigrations()
  const versions = migrations.map((migration) => migration.name.split('_')[0])

  console.log(`\nStarScale Nexus: apply migrations to the cloud project`)
  console.log(`Project: ${settings.projectRef}  ${settings.apiUrl}`)
  await checkKeys(settings)
  console.log('Publishable key: accepted by this project.')

  const password = await askDatabasePassword()
  const before = await readState(settings, password)
  console.log(`Connection: encrypted, certificate verified. PostgreSQL ${before.version}.`)

  const plan = migrationPlan(before.applied, versions)
  if (plan.problem) throw new CloudProblem(`${plan.problem}. Nothing was applied.`)
  if (before.applied.length === 0 && before.hasNexusTables) {
    throw new CloudProblem('Nexus tables already exist but no migration history does: the database was changed outside Nexus. Nothing was applied.')
  }
  if (plan.pending.length === 0) {
    console.log(`\nAll ${versions.length} migrations are already applied. Nothing to do.\n`)
    process.exit(0)
  }

  const pending = migrations.filter((migration) => plan.pending.includes(migration.name.split('_')[0]))
  for (const migration of pending) {
    const reasons = destructiveStatements(migration.sql)
    if (reasons.length > 0) {
      throw new CloudProblem(
        `${migration.name} ${reasons.join(' and ')}. This tool never applies such a migration to the cloud project. Nothing was applied.`,
      )
    }
  }

  console.log(`\nMigrations to apply, in order:`)
  for (const migration of pending) console.log(`  ${migration.name}`)
  console.log('\nThe Supabase tool will now show its own preview. This changes nothing.\n')
  if (!runSupabase(entry, settings, password, { dryRun: true })) {
    throw new CloudProblem('the preview did not complete. Nothing was applied.')
  }

  console.log(
    [
      '',
      'Applying adds Nexus tables, functions and access rules to the cloud database.',
      'It creates no accounts and adds no records. This tool cannot undo it.',
      '',
    ].join('\n'),
  )
  if (!(await confirmProject(settings.projectRef))) throw new CloudProblem('nothing was applied.')

  console.log('\nApplying. If the Supabase tool lists the migrations again and asks Y/n, answer y.\n')
  const pushed = runSupabase(entry, settings, password, { dryRun: false })

  const after = await readState(settings, password)
  const check = migrationPlan(after.applied, versions)
  if (after.applied.length === before.applied.length) {
    throw new CloudProblem('nothing was applied (the Supabase tool stopped or was answered n).')
  }
  if (!pushed || check.problem || check.pending.length > 0) {
    throw new CloudProblem(
      `the migrations were not all applied (${after.applied.length} of ${versions.length} recorded). ` +
        'Run npm run cloud:status and report what it shows. Do not run anything else.',
    )
  }
  console.log(`\nAll ${versions.length} migrations applied and recorded. Next: npm run test:security:cloud\n`)
} catch (error) {
  stop(error instanceof CloudProblem ? error.message : `something went wrong: ${error.message}`)
}
