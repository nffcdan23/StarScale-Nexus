// NEXUS-ADMIN-ONLY: the restore drill. Never imported by the app.
//
// Restores a FICTIONAL backup into the cloud database the same way a real
// restore would (rules active, original dates and revisions put back,
// everything read back and compared), checks the restored records are
// visible to their owner only with an authenticator code, and then undoes
// the whole drill. Everything happens inside one transaction that is always
// rolled back, so nothing is ever kept and nothing has to be deleted.

import { randomUUID } from 'node:crypto'
import { asBackupProblem, readTables, restoreRecords } from '../backup/database.mjs'
import { BackupProblem, dataFingerprint } from '../backup/format.mjs'

async function visibleCounts(db, claims) {
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
  const { rows } = await db.query(`
    select (select count(*)::int from public.contexts) as contexts,
           (select count(*)::int from public.tasks) as tasks,
           (select count(*)::int from public.notes) as notes`)
  return rows[0]
}

/**
 * Runs the drill. Resolves with the counts and fingerprint if every step
 * matched; rejects with a BackupProblem otherwise. Either way the database
 * is left exactly as it was.
 */
export async function restoreDrill(db, backup) {
  const ownerId = randomUUID()
  await db.query('begin')
  try {
    // A stand-in owner that exists only inside this transaction.
    await db.query('insert into auth.users (id) values ($1::uuid)', [ownerId])
    await db.query(`insert into private.identities (user_id, kind, label) values ($1::uuid, 'owner', 'Restore drill')`, [ownerId])

    await restoreRecords(db, backup, ownerId)
    const fingerprint = dataFingerprint(await readTables(db, ownerId))
    if (fingerprint !== backup.dataFingerprint) {
      throw new BackupProblem('The restored records do not match the backup.')
    }

    // Through the real access rules, as the Data API would ask.
    await db.query('set local role authenticated')
    const withCode = await visibleCounts(db, { sub: ownerId, role: 'authenticated', aal: 'aal2' })
    const expected = backup.counts
    if (withCode.contexts !== expected.contexts || withCode.tasks !== expected.tasks || withCode.notes !== expected.notes) {
      throw new BackupProblem(`The owner, with an authenticator code, sees ${JSON.stringify(withCode)} instead of ${JSON.stringify(expected)}.`)
    }
    const withoutCode = await visibleCounts(db, { sub: ownerId, role: 'authenticated', aal: 'aal1' })
    if (withoutCode.contexts + withoutCode.tasks + withoutCode.notes !== 0) {
      throw new BackupProblem('The owner without an authenticator code could see restored records.')
    }
    return { counts: expected, fingerprint }
  } catch (error) {
    throw asBackupProblem(error)
  } finally {
    await db.query('rollback')
  }
}
