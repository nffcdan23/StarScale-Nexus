// NEXUS-ADMIN-ONLY: checks a saved backup and proves it can be restored.
// Never imported by the app.
//
//   npm run backup:verify                  the newest backup in the backups folder
//   npm run backup:verify -- "<file>"      any backup file, for example a second copy
//
// Reads only the file. The restore goes into a temporary in-memory database
// that disappears afterwards; no Nexus database is touched. Runs on any
// computer, but real backups exist only on the Windows PC.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { newestBackup } from './files.mjs'
import { BackupProblem, describeCounts, readBackup, shortFingerprint } from './format.mjs'
import { VERIFIED_WHERE, verifyBackup } from './verify.mjs'

function stop(message) {
  console.error(`\nVerification FAILED: ${message}\n`)
  process.exit(1)
}

const argument = process.argv[2]
if (process.argv.length > 3) stop('give at most one file. Put the path in quotes if it contains spaces.')
const path = argument ? resolve(argument) : await newestBackup()
if (!path) stop('there are no backups in the backups folder yet. Make one with: npm run backup:local')

console.log(`\nStarScale Nexus backup check\nFile: ${path}`)

let text
try {
  text = await readFile(path, 'utf8')
} catch (error) {
  stop(`the file could not be opened (${error.code ?? error.message}).`)
}

try {
  const backup = readBackup(text)
  console.log(`Made: ${new Date(backup.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} from the ${backup.source.environment} database`)
  console.log(`  ${describeCounts(backup.counts)}`)
  console.log('Checking the file...')
  console.log('  Intact.')
  console.log('Restoring it into a temporary test database and comparing every record...')
  const result = await verifyBackup(backup)
  console.log('  Identical.')
  console.log(`\nBackup verified. Data fingerprint: ${shortFingerprint(result.fingerprint)}`)
  console.log(`${VERIFIED_WHERE}\n`)
} catch (error) {
  stop(error instanceof BackupProblem ? error.message : `something went wrong: ${error.message}`)
}
