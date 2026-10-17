// NEXUS-ADMIN-ONLY: backs up the owner's contexts, tasks and notes from the
// LOCAL Supabase database, then proves the backup can be restored. Never
// imported by the app.
//
//   npm run backup:local
//   npm run backup:local -- --owner <account id>   (only if asked to choose)
//
// Windows PC only. It reads through a read-only connection, inside a
// read-only transaction, so it cannot change, reset or overwrite anything in
// the database. It connects only to this computer, never to Supabase Cloud.
// See docs/backup-and-restore.md.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPg } from '../../tools/windows/load-pg.mjs'
import { listOwners, readBackupData } from './database.mjs'
import { backupsDir, saveBackup, syncFolderWarning } from './files.mjs'
import { BackupProblem, createBackup, describeCounts, readBackup, shortFingerprint } from './format.mjs'
import { VERIFIED_WHERE, verifyBackup } from './verify.mjs'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function stop(message) {
  console.error(`\nBackup stopped: ${message}\n`)
  process.exit(1)
}

function readDatabaseAddress() {
  if (process.platform !== 'win32') stop('this runs only on the Windows PC, never on the MacBook.')
  const envFile = join(projectRoot, '.env.security.local')
  if (!existsSync(envFile)) stop('.env.security.local is missing. It is the same file the real security checks use.')
  process.loadEnvFile(envFile)
  const dbUrl = process.env.NEXUS_TEST_DB_URL
  if (!dbUrl) stop('NEXUS_TEST_DB_URL is missing from .env.security.local.')
  const host = new URL(dbUrl).hostname
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    stop(`${host} is not this computer. This backup reads only the local Supabase database.`)
  }
  return dbUrl
}

function readOwnerArgument(argv) {
  if (argv.length === 0) return null
  if (argv.length === 2 && argv[0] === '--owner') return argv[1]
  stop(`unexpected arguments "${argv.join(' ')}". Use: npm run backup:local  (or add -- --owner <account id> when asked)`)
}

async function chooseOwner(client, requested) {
  const owners = await listOwners(client)
  if (owners.length === 0) stop('no owner account is registered in the local database, so there is nothing to back up.')
  if (requested) {
    const owner = owners.find((candidate) => candidate.id === requested)
    if (!owner) stop(`${requested} is not a registered owner account in the local database.`)
    return owner
  }
  if (owners.length === 1) return owners[0]
  const list = owners.map((owner) => `  ${owner.id}  ${owner.label ?? '(no label)'}  ${describeCounts(owner)}`).join('\n')
  stop(`there is more than one owner account. Run again with the one to back up:\n${list}\n\n  npm run backup:local -- --owner <account id>`)
}

const dbUrl = readDatabaseAddress()
const requestedOwner = readOwnerArgument(process.argv.slice(2))
const pg = loadPg()

console.log('\nStarScale Nexus backup: local database')
console.log('Reading the local database (read-only)...')

// Read-only for the whole connection, as well as for the transaction.
const client = new pg.Client({
  connectionString: dbUrl,
  application_name: 'nexus-backup',
  options: '-c default_transaction_read_only=on',
})

let path
let backup
try {
  try {
    await client.connect()
  } catch (error) {
    stop(
      `could not reach the local database (${error.message}). ` +
        'Is the local Supabase stack running? Start Docker Desktop, then run: npm run supabase -- start',
    )
  }
  const owner = await chooseOwner(client, requestedOwner)
  const { data, migrations, otherRecords, layout } = await readBackupData(client, { ownerId: owner.id })
  backup = createBackup({ data, source: { environment: 'local', migrations }, formatVersion: layout })
  path = await saveBackup(backup, { environment: 'local' })

  console.log(`  ${describeCounts(backup.counts)}`)
  if (backup.formatVersion === 1) console.log('  (The database has no projects yet, so this backup is in format 1. It can still be restored.)')
  if (otherRecords > 0) {
    console.log(`  Not included: ${otherRecords} records that belong to other accounts (for example test accounts).`)
  }
  console.log(`Saved: ${relative(projectRoot, path)}`)
} catch (error) {
  stop(error instanceof BackupProblem ? error.message : `something went wrong: ${error.message}`)
} finally {
  await client.end().catch(() => {})
}

try {
  console.log('Checking the saved file...')
  const saved = readBackup(await readFile(path, 'utf8'))
  console.log('  Intact.')
  console.log('Restoring it into a temporary test database and comparing every record...')
  const result = await verifyBackup(saved)
  console.log('  Identical.')
  console.log(`\nBackup verified. Data fingerprint: ${shortFingerprint(result.fingerprint)}`)
  console.log(VERIFIED_WHERE)
  const warning = syncFolderWarning(backupsDir)
  if (warning) console.log(`\nWarning: ${warning}`)
  console.log('\nKeep a second copy somewhere private: see docs/backup-and-restore.md.\n')
} catch (error) {
  stop(
    `the backup was saved as ${relative(projectRoot, path)} but could NOT be verified, so do not rely on it. ${error.message}`,
  )
}
