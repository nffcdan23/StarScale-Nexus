import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectRoot } from './paths.mjs'

const migrationsDir = join(projectRoot, 'supabase', 'migrations')

/** Every migration, oldest first, as { name, sql }. */
export async function loadMigrations() {
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort()
  return Promise.all(
    names.map(async (name) => ({
      name,
      // Normalised line endings, so the fingerprint is the same on macOS and Windows.
      sql: (await readFile(join(migrationsDir, name), 'utf8')).replace(/\r\n/g, '\n'),
    })),
  )
}

/**
 * A short code that changes whenever any migration changes. Real-Supabase
 * results are stored with it, so results from older migrations show as stale.
 */
export function fingerprint(migrations) {
  const hash = createHash('sha256')
  for (const { name, sql } of migrations) hash.update(name).update('\n').update(sql).update('\n')
  return hash.digest('hex').slice(0, 12)
}
