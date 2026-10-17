// Checks shared by both cloud runs: the full run on an empty project
// (run-cloud.mjs) and the check on a project in use (run-cloud-live.mjs).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { restoreDrill } from '../../../scripts/cloud/drill.mjs'
import { CloudProblem } from '../../../scripts/cloud/settings.mjs'
import { compareStructures, describeStructure, readStructure } from '../../../scripts/cloud/structure.mjs'
import { loadPg } from '../../../tools/windows/load-pg.mjs'
import { makeFictionalBackup } from '../../backup/fictional-data.mjs'
import { projectRoot } from '../lib/paths.mjs'

/** The verified LOCAL database, read-only, to compare the cloud structure with. */
async function connectLocalReadOnly() {
  const file = join(projectRoot, '.env.security.local')
  if (!existsSync(file)) throw new CloudProblem('.env.security.local is missing, so the local database cannot be read')
  const dbUrl = parseEnv(readFileSync(file, 'utf8')).NEXUS_TEST_DB_URL
  if (!dbUrl) throw new CloudProblem('NEXUS_TEST_DB_URL is missing from .env.security.local')
  const host = new URL(dbUrl).hostname
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new CloudProblem(`${host} is not this computer`)
  const client = new (loadPg().Client)({ connectionString: dbUrl, application_name: 'nexus-cloud-tools' })
  try {
    await client.connect()
    await client.query('set default_transaction_read_only = on')
  } catch (error) {
    await client.end().catch(() => {})
    throw new CloudProblem(
      `the local database did not answer (${error.code ?? error.message}). Start Docker Desktop and the local stack ` +
        '(npm run supabase -- start), then run the cloud checks again',
    )
  }
  return client
}

export async function structureCheck(cloudDb, cloudVersion) {
  let local
  try {
    local = await connectLocalReadOnly()
  } catch (error) {
    return { id: 'CLOUD-04', status: 'not-executed', detail: error.message }
  }
  try {
    const localVersion = (await local.query(`select current_setting('server_version') as v`)).rows[0].v
    const expected = await readStructure(local)
    const actual = await readStructure(cloudDb)
    const differences = compareStructures(expected, actual)
    if (differences.length === 0) {
      return { id: 'CLOUD-04', status: 'passed', detail: `${describeStructure(actual)}; PostgreSQL local ${localVersion}, cloud ${cloudVersion}` }
    }
    const shown = differences.slice(0, 10).join('; ')
    const more = differences.length > 10 ? `; and ${differences.length - 10} more` : ''
    return { id: 'CLOUD-04', status: 'failed', detail: `${differences.length} differences (PostgreSQL local ${localVersion}, cloud ${cloudVersion}): ${shown}${more}` }
  } finally {
    await local.end().catch(() => {})
  }
}

export async function drillCheck(db) {
  try {
    const result = await restoreDrill(db, await makeFictionalBackup())
    const { contexts, tasks, notes } = result.counts
    return { id: 'CLOUD-05', status: 'passed', detail: `${contexts} contexts, ${tasks} tasks, ${notes} notes restored identically, then undone` }
  } catch (error) {
    return { id: 'CLOUD-05', status: 'failed', detail: error.message }
  }
}
