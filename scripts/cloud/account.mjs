// NEXUS-ADMIN-ONLY: creates the Nexus sign-ins in the CLOUD project. Never
// imported by the app.
//
//   npm run cloud:account -- owner --email you@example.com
//   npm run cloud:account -- tv --email office-tv@example.com
//   npm run cloud:account -- list
//
// Windows PC only. Refuses unless the recorded cloud security checks all
// passed for this project and these migrations, every migration is applied,
// and the project has no stray accounts. Creating a sign-in needs the
// database password and a temporary secret key, both typed into a hidden
// prompt, and the project id typed to confirm. Nothing is copied from the
// local database: the cloud sign-ins are new, with new ids, and the owner
// sets up a new authenticator on first sign-in. The password is random and
// shown once. `list` needs only the database password and changes nothing.

import { loadMigrations, fingerprint } from '../../tests/security/lib/migrations.mjs'
import { cases, cloudOnlyCases, realOnlyCases } from '../../tests/security/lib/cases.mjs'
import { loadCloudResults } from '../../tests/security/lib/report.mjs'
import { projectRoot, requireWindows } from '../../tools/windows/windows-only.mjs'
import { generatePassword } from '../lib/passwords.mjs'
import { accountPlan, verificationProblem } from './accounts.mjs'
import { checkKeys, connectCloud, migrationPlan, readProjectState } from './project.mjs'
import { askDatabasePassword, askSecretKey, confirmProject } from './prompt.mjs'
import { CloudProblem, loadCloudSettings, redact } from './settings.mjs'

function stop(message) {
  console.error(`\nStopped: ${message}\n`)
  process.exit(1)
}

function readArguments(argv) {
  const [command, ...rest] = argv
  if (command === 'list' && rest.length === 0) return { command }
  if ((command === 'owner' || command === 'tv') && rest.length === 2 && rest[0] === '--email') {
    return { command, email: rest[1] }
  }
  stop('use: npm run cloud:account -- owner --email ADDRESS | tv --email ADDRESS | list')
}

async function registeredSignIns(db) {
  const { rows } = await db.query(`
    select i.user_id::text as "userId", i.kind, lower(u.email) as email
    from private.identities i join auth.users u on u.id = i.user_id
    order by i.created_at`)
  return rows
}

async function admin(settings, secretKey, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${settings.apiUrl}/auth/v1/admin${path}`, {
    method,
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    // Some replies have no body.
  }
  return { ok: response.ok, status: response.status, data }
}

try {
  requireWindows('This command')
} catch (error) {
  stop(error.message)
}

const secrets = []
try {
  const { command, email } = readArguments(process.argv.slice(2))
  const settings = loadCloudSettings(projectRoot)
  const migrations = await loadMigrations()

  // Before any secret is typed: the cloud project must be verified.
  const problem = verificationProblem(await loadCloudResults(), {
    fingerprint: fingerprint(migrations),
    projectRef: settings.projectRef,
    expectedIds: [...cases, ...realOnlyCases, ...cloudOnlyCases].map((testCase) => testCase.id),
  })
  if (problem) throw new CloudProblem(`the cloud project is not verified: ${problem}`)

  console.log(`\nStarScale Nexus cloud sign-ins`)
  console.log(`Project: ${settings.projectRef}  ${settings.apiUrl} (security checks recorded as passed)`)
  await checkKeys(settings)

  const password = await askDatabasePassword()
  secrets.push(password)
  const db = await connectCloud(settings, password, { readOnly: command === 'list' })
  try {
    const state = await readProjectState(db)
    const plan = migrationPlan(state.applied, migrations.map((migration) => migration.name.split('_')[0]))
    if (plan.problem || plan.pending.length > 0) {
      throw new CloudProblem('the cloud migrations are not all applied. Run npm run cloud:status. Nothing was created.')
    }
    const registered = await registeredSignIns(db)

    if (command === 'list') {
      if (registered.length === 0) console.log('No Nexus sign-ins yet.')
      for (const entry of registered) console.log(`  ${entry.kind.padEnd(5)} ${entry.email}`)
      const stray = state.counts.accounts - registered.length
      if (stray > 0) console.log(`  and ${stray} sign-in accounts that are NOT Nexus sign-ins: check Authentication → Users.`)
      console.log('\nNothing was changed.\n')
    } else {
      const decided = accountPlan(command, { email, registered, accounts: state.counts.accounts })
      if (decided.problem) throw new CloudProblem(decided.problem)

      const secretKey = await askSecretKey()
      secrets.push(secretKey)
      await checkKeys(settings, { secretKey })

      const what = command === 'owner' ? 'the OWNER sign-in' : 'a TV sign-in (read-only TV summary, no notes)'
      console.log(`\nThis creates ${what} ${decided.email} in project ${settings.projectRef}.`)
      if (!(await confirmProject(settings.projectRef))) throw new CloudProblem('nothing was created.')

      const newPassword = generatePassword()
      const created = await admin(settings, secretKey, '/users', {
        method: 'POST',
        body: { email: decided.email, password: newPassword, email_confirm: true, app_metadata: { nexus_role: command } },
      })
      if (!created.ok || !created.data?.id) {
        const code = created.data?.error_code ?? created.data?.code
        throw new CloudProblem(`Supabase did not create the sign-in (status ${created.status}${code ? `, ${code}` : ''}). Nothing was created.`)
      }
      try {
        await db.query(`insert into private.identities (user_id, kind, owner_id, label) values ($1, $2, $3, $4)`, [
          created.data.id,
          command,
          decided.ownerId,
          command === 'tv' ? 'TV' : 'Owner',
        ])
      } catch (error) {
        // Never leave a sign-in that exists but is not registered: remove the one just made.
        await admin(settings, secretKey, `/users/${created.data.id}`, { method: 'DELETE' })
        throw new CloudProblem(`could not register the sign-in, so the account just created was removed again (${error.message}).`)
      }

      console.log(`\nCreated ${what} ${decided.email}.`)
      console.log(`\n  Password: ${newPassword}\n`)
      console.log('This is the only time the password is shown. Save it in your password manager now.')
      if (command === 'owner') {
        console.log('\nNext, before using this password anywhere else: open StarScale Nexus Cloud, sign in, and set up')
        console.log('your authenticator when Nexus asks. Until then, anyone with the password could do it.')
      } else {
        console.log('\nIt can read only the redacted TV summary. It cannot read notes or change anything.')
      }
      console.log('\nWhen you have finished creating sign-ins, delete the temporary secret key in the dashboard.\n')
    }
  } finally {
    await db.close()
  }
} catch (error) {
  stop(redact(error instanceof CloudProblem ? error.message : `something went wrong: ${error.message}`, secrets))
}
