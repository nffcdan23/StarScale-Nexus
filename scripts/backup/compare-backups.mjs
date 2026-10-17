// NEXUS-ADMIN-ONLY: shows whether two backups hold exactly the same records.
// Never imported by the app.
//
//   npm run backup:compare                       the two newest backups of the same database
//   npm run backup:compare -- "<before>" "<after>"
//
// Used around a migration: back up, migrate, back up again, compare. A
// migration that only adds things leaves every existing record unchanged;
// a backup made before projects existed (format 1) is read as having no
// projects and every task and note in the Inbox, as the migration leaves
// them. Reads only the files; runs on any computer.

import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { compareBackups } from './database.mjs'
import { listBackups } from './files.mjs'
import { BackupProblem, describeCounts, readBackup } from './format.mjs'

function stop(message) {
  console.error(`\nComparison stopped: ${message}\n`)
  process.exit(1)
}

async function choosePaths(argv) {
  if (argv.length === 2) return argv.map((path) => resolve(path))
  if (argv.length !== 0) stop('give two backup files, or none to compare the two newest backups of the same database.')
  const all = await listBackups()
  const newest = all.at(-1)
  if (!newest) stop('there are no backups in the backups folder.')
  const same = all.filter((entry) => entry.environment === newest.environment)
  if (same.length < 2) stop(`there is only one ${newest.environment} backup. Make another first.`)
  return [same.at(-2).path, same.at(-1).path]
}

async function load(path) {
  try {
    return readBackup(await readFile(path, 'utf8'))
  } catch (error) {
    stop(`${relative(process.cwd(), path)}: ${error instanceof BackupProblem ? error.message : error.message}`)
  }
}

const [beforePath, afterPath] = await choosePaths(process.argv.slice(2))
const before = await load(beforePath)
const after = await load(afterPath)
console.log(`\nBefore: ${relative(process.cwd(), beforePath)}  (format ${before.upgradedFrom ?? before.formatVersion}; ${describeCounts(before.counts)})`)
console.log(`After:  ${relative(process.cwd(), afterPath)}  (format ${after.upgradedFrom ?? after.formatVersion}; ${describeCounts(after.counts)})`)

const difference = compareBackups(before, after)
if (difference) {
  console.error(`\nDIFFERENT: ${difference}.`)
  console.error('If Nexus was used between the two backups, that would explain it; otherwise stop and report this.\n')
  process.exit(1)
}
console.log('\nThe same records: every context, project, task and note is unchanged, and nothing was added or lost.\n')
