// NEXUS-ADMIN-ONLY: backs up the owner's contexts, tasks and notes from the
// CLOUD project, then proves the backup can be restored. Never imported by
// the app.
//
//   npm run backup:cloud        Windows PC only
//
// Reaches only the project named in .env.cloud.local, over TLS verified with
// supabase-ca.crt, after checking its publishable key. The database password
// is typed into a hidden prompt and never stored or shown. The connection is
// read-only and the backup is read in one read-only transaction, so nothing
// in the project can be changed. No secret key is needed. The file goes to
// the Git-ignored backups folder; see docs/backup-and-restore.md.

import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { checkKeys, connectCloud } from '../cloud/project.mjs'
import { askDatabasePassword } from '../cloud/prompt.mjs'
import { CloudProblem, loadCloudSettings, redact, shortRef } from '../cloud/settings.mjs'
import { projectRoot, requireWindows } from '../../tools/windows/windows-only.mjs'
import { listOwners, readBackupData } from './database.mjs'
import { backupsDir, saveBackup, syncFolderWarning } from './files.mjs'
import { BackupProblem, createBackup, describeCounts, readBackup, shortFingerprint } from './format.mjs'
import { VERIFIED_WHERE, verifyBackup } from './verify.mjs'

function stop(message) {
  console.error(`\nBackup stopped: ${message}\n`)
  process.exit(1)
}

try {
  requireWindows('The cloud backup')
} catch (error) {
  stop(error.message)
}
if (process.argv.length > 2) stop('npm run backup:cloud takes no arguments.')

const secrets = []
let path
try {
  const settings = loadCloudSettings(projectRoot)
  console.log('\nStarScale Nexus backup: cloud project')
  console.log(`Project: ${settings.projectRef}  ${settings.apiUrl}`)
  await checkKeys(settings)

  const password = await askDatabasePassword()
  secrets.push(password)
  const db = await connectCloud(settings, password, { readOnly: true })
  try {
    console.log('Reading the cloud project (read-only connection)...')
    const owners = await listOwners(db)
    if (owners.length !== 1) {
      throw new CloudProblem(`expected exactly one owner sign-in in the cloud project, found ${owners.length}. Nothing was saved.`)
    }
    const { data, migrations, otherRecords, layout } = await readBackupData(db, { ownerId: owners[0].id })
    const backup = createBackup({
      data,
      source: { environment: 'cloud', project: shortRef(settings.projectRef), migrations },
      formatVersion: layout,
    })
    path = await saveBackup(backup, { environment: 'cloud' })
    console.log(`  ${describeCounts(backup.counts)}`)
    if (backup.formatVersion === 1) console.log('  (The database has no projects yet, so this backup is in format 1. It can still be restored.)')
    if (otherRecords > 0) console.log(`  Not included: ${otherRecords} records that belong to other accounts.`)
    console.log(`Saved: ${relative(projectRoot, path)}`)
  } finally {
    await db.close()
  }
} catch (error) {
  const message = error instanceof CloudProblem || error instanceof BackupProblem ? error.message : `something went wrong: ${error.message}`
  stop(redact(message, secrets))
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
  stop(`the backup was saved as ${relative(projectRoot, path)} but could NOT be verified, so do not rely on it. ${error.message}`)
}
