// NEXUS-ADMIN-ONLY: proves a backup can be restored. Never imported by the app.
//
// The backup is restored into a throwaway in-memory PostgreSQL database
// (PGlite) built from this project's migrations, with the same small
// imitation of Supabase that the simulated security checks use. Every record
// is then read back and compared with the backup. Nothing is written to disk
// and nothing touches the Nexus database.
//
// PGlite is real PostgreSQL, but it is not Supabase. Restoring into a real
// Supabase database is proved separately (Phase 3c-4b-2).

import { randomUUID } from 'node:crypto'
import { loadMigrations } from '../../tests/security/lib/migrations.mjs'
import { createMockDatabase } from '../../tests/security/mock/pglite-database.mjs'
import { readBackupData, restoreBackup } from './database.mjs'
import { BackupProblem, dataFingerprint } from './format.mjs'

export const VERIFIED_WHERE =
  "This check used a temporary in-memory PostgreSQL database (PGlite) built from this project's migrations. " +
  'It is not real Supabase: restoring into a real Supabase database is still to be proved (Phase 3c-4b-2).'

/**
 * Restores an already-read backup (see readBackup) into a disposable
 * database and compares every record. Resolves with the counts and the
 * restored data's fingerprint; rejects with a BackupProblem otherwise.
 */
export async function verifyBackup(backup) {
  const migrations = await loadMigrations()
  const known = new Set(migrations.map((migration) => migration.name.split('_')[0]))
  const unknown = backup.source.migrations.filter((version) => !known.has(version))
  if (unknown.length > 0) {
    throw new BackupProblem(
      `The backup was made from a database with migrations this project does not have (${unknown.join(', ')}). ` +
        'Use the version of Nexus it was made with.',
    )
  }

  const db = await createMockDatabase(migrations)
  try {
    // A stand-in owner with a different account id, as in any real restore.
    const ownerId = randomUUID()
    await db.query('insert into auth.users (id) values ($1::uuid)', [ownerId])
    await db.query(`insert into private.identities (user_id, kind, label) values ($1::uuid, 'owner', 'Restore check')`, [
      ownerId,
    ])

    await restoreBackup(db, backup, ownerId)

    // Read again, after the restore has finished, exactly as a backup would.
    const { data } = await readBackupData(db, { ownerId })
    const fingerprint = dataFingerprint(data)
    if (fingerprint !== backup.dataFingerprint) {
      throw new BackupProblem('The restored records do not match the backup after restoring. The backup cannot be trusted.')
    }
    return { counts: backup.counts, fingerprint }
  } finally {
    await db.close()
  }
}
