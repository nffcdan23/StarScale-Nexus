// NEXUS-ADMIN-ONLY: where backups are kept and how they are saved. Never
// imported by the app.
//
// Backups go into the project's backups folder, which Git ignores, so they
// are never committed or uploaded with the code. They hold the owner's notes
// in readable form: see docs/backup-and-restore.md for keeping them private.

import { existsSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BackupProblem, readBackup } from './format.mjs'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const backupsDir = join(projectRoot, 'backups')

const NAME = /^nexus-([a-z]+)-(\d{4}-\d{2}-\d{2}-\d{6})\.json$/

function pad(number) {
  return String(number).padStart(2, '0')
}

/** For example nexus-local-2026-10-17-103015.json (this computer's local time). */
export function backupFileName(environment, date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `nexus-${environment}-${day}-${time}.json`
}

/**
 * Saves a backup without ever replacing an existing file. It is written under
 * a temporary name, flushed to disk, read back and checked, and only then
 * given its real name, so a half-written file never looks like a backup.
 */
export async function saveBackup(backup, { environment, dir = backupsDir, now = new Date() }) {
  await mkdir(dir, { recursive: true })
  const name = backupFileName(environment, now)
  const finalPath = join(dir, name)
  if (existsSync(finalPath)) {
    throw new BackupProblem(`A backup named ${name} already exists. Wait a moment and run the backup again.`)
  }
  const partialPath = `${finalPath}.partial`
  const handle = await open(partialPath, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(backup, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    readBackup(await readFile(partialPath, 'utf8'))
    await rename(partialPath, finalPath)
  } catch (error) {
    await rm(partialPath, { force: true })
    throw error
  }
  return finalPath
}

/** The most recent backup in a folder, or null if there is none. */
export async function newestBackup(dir = backupsDir) {
  if (!existsSync(dir)) return null
  const names = (await readdir(dir)).filter((name) => NAME.test(name))
  if (names.length === 0) return null
  names.sort((a, b) => a.match(NAME)[2].localeCompare(b.match(NAME)[2]))
  return join(dir, names.at(-1))
}

/** A warning if the folder looks as if a cloud storage service copies it, or null. */
export function syncFolderWarning(path) {
  const service = path.match(/onedrive|dropbox|google ?drive|icloud/i)
  if (!service) return null
  return (
    `This folder appears to be inside ${service[0]}, which copies files to the internet. ` +
    'Backups hold your notes in readable form: see docs/backup-and-restore.md before keeping them there.'
  )
}
