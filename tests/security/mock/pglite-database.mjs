import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { imitationPath } from '../lib/paths.mjs'

/**
 * A throwaway in-memory PostgreSQL (PGlite) with the Supabase imitation and
 * the given migrations applied. Nothing is written to disk.
 */
export async function createMockDatabase(migrations) {
  const db = new PGlite()
  await db.exec(await readFile(imitationPath, 'utf8'))
  for (const migration of migrations) {
    try {
      await db.exec(migration.sql)
    } catch (error) {
      await db.close()
      throw new Error(`Migration ${migration.name} failed to apply: ${error.message}`, { cause: error })
    }
  }
  return db
}
