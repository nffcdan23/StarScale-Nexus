// NEXUS-ADMIN-ONLY: reads a backup out of a Nexus database and restores one
// into an empty Nexus database. Never imported by the app.
//
// Works with any client that has query(sql, params) returning { rows }: the
// PostgreSQL client (pg) on the Windows PC, or PGlite for the throwaway
// databases that prove a backup can be restored.

import { BackupProblem, canonicalJson, TABLE_NAMES, TABLES } from './format.mjs'

// Every name placed into SQL text below comes from TABLES in format.mjs,
// never from a file or an argument. Values always travel as parameters.

/** The registered owners, with how many records each has. */
export async function listOwners(db) {
  const { rows } = await db.query(`
    select i.user_id::text as id,
           i.label,
           (select count(*)::int from public.contexts c where c.owner_id = i.user_id) as contexts,
           (select count(*)::int from public.tasks t where t.owner_id = i.user_id) as tasks,
           (select count(*)::int from public.notes n where n.owner_id = i.user_id) as notes
    from private.identities i
    where i.kind = 'owner'
    order by i.created_at, i.user_id
  `)
  return rows
}

/** Refuses a database whose tables have columns this tool does not know, or lack ones it needs. */
export async function checkStructure(db) {
  const { rows } = await db.query(`
    select table_name::text as table_name, column_name::text as column_name
    from information_schema.columns
    where table_schema = 'public' and table_name in ('contexts', 'tasks', 'notes')
  `)
  for (const table of TABLE_NAMES) {
    const actual = rows.filter((row) => row.table_name === table).map((row) => row.column_name)
    const expected = ['owner_id', ...Object.keys(TABLES[table].columns), ...TABLES[table].derived]
    const unexpected = actual.filter((column) => !expected.includes(column))
    const missing = expected.filter((column) => !actual.includes(column))
    if (unexpected.length > 0 || missing.length > 0) {
      const parts = [
        unexpected.length > 0 ? `columns this tool does not know: ${unexpected.join(', ')}` : '',
        missing.length > 0 ? `missing columns: ${missing.join(', ')}` : '',
      ].filter(Boolean)
      throw new BackupProblem(
        `The ${table} table does not match what the backup tool knows (${parts.join('; ')}). ` +
          'The tool must be updated with the database before it can be used.',
      )
    }
  }
}

/**
 * The owner's records, exactly as stored, without the owner's account id and
 * without derived columns. Must run inside a transaction: times are read in
 * UTC so the same moment always looks the same.
 */
export async function readTables(db, ownerId) {
  await db.query(`set local timezone to 'UTC'`)
  const data = {}
  for (const table of TABLE_NAMES) {
    const omit = ['owner_id', ...TABLES[table].derived].map((column) => `'${column}'`).join(', ')
    const { rows } = await db.query(
      `select coalesce(jsonb_agg(to_jsonb(t) - array[${omit}]::text[] order by t.id), '[]'::jsonb) as rows
       from public.${table} t
       where t.owner_id = $1::uuid`,
      [ownerId],
    )
    data[table] = rows[0].rows
  }
  return data
}

/** The migration versions the database records, if it keeps that list (Supabase does). */
async function readMigrations(db) {
  const { rows } = await db.query(`select to_regclass('supabase_migrations.schema_migrations') is not null as kept`)
  if (!rows[0].kept) return []
  const result = await db.query(
    `select coalesce(jsonb_agg(version order by version), '[]'::jsonb) as versions from supabase_migrations.schema_migrations`,
  )
  return result.rows[0].versions
}

/**
 * Reads everything a backup needs in one read-only transaction: a consistent
 * snapshot, and the database refuses any write while it lasts.
 * Returns { data, migrations, otherRecords } where otherRecords counts
 * records that belong to other accounts and are therefore not included.
 */
export async function readBackupData(db, { ownerId }) {
  await db.query('begin transaction isolation level repeatable read read only')
  try {
    await checkStructure(db)
    const data = await readTables(db, ownerId)
    const migrations = await readMigrations(db)
    const { rows } = await db.query(
      `select (select count(*) from public.contexts where owner_id <> $1::uuid)
            + (select count(*) from public.tasks where owner_id <> $1::uuid)
            + (select count(*) from public.notes where owner_id <> $1::uuid) as other_records`,
      [ownerId],
    )
    await db.query('commit')
    return { data, migrations, otherRecords: Number(rows[0].other_records) }
  } catch (error) {
    await db.query('rollback')
    throw error
  }
}

function recordset(table, columns) {
  return columns.map((column) => `${column} ${TABLES[table].columns[column]}`).join(', ')
}

async function insertRows(db, table, rows, ownerId) {
  if (rows.length === 0) return
  const columns = Object.keys(TABLES[table].columns)
  await db.query(
    `insert into public.${table} (owner_id, ${columns.join(', ')})
     select $2::uuid, ${columns.map((column) => `r.${column}`).join(', ')}
     from jsonb_to_recordset($1::jsonb) as r(${recordset(table, columns)})`,
    [JSON.stringify(rows), ownerId],
  )
}

async function putBackRuleColumns(db, table, rows, ownerId) {
  const columns = TABLES[table].setByRules
  if (rows.length === 0 || columns.length === 0) return
  await db.query(
    `update public.${table} as t
     set ${columns.map((column) => `${column} = r.${column}`).join(', ')}
     from jsonb_to_recordset($1::jsonb) as r(${recordset(table, ['id', ...columns])})
     where t.id = r.id and t.owner_id = $2::uuid`,
    [JSON.stringify(rows), ownerId],
  )
}

/** The first difference between two sets of records, in words, or null if identical. */
export function describeDifference(expected, actual) {
  for (const table of TABLE_NAMES) {
    if (expected[table].length !== actual[table].length) {
      return `${table}: ${expected[table].length} in the backup, ${actual[table].length} restored`
    }
    const restored = new Map(actual[table].map((row) => [row.id, row]))
    for (const row of expected[table]) {
      const match = restored.get(row.id)
      if (!match) return `${table} record ${row.id} was not restored`
      for (const column of Object.keys(TABLES[table].columns)) {
        if (canonicalJson(row[column]) !== canonicalJson(match[column])) {
          return `${table} record ${row.id}: ${column} differs after restoring`
        }
      }
    }
  }
  return null
}

/**
 * Restores a backup (already checked by readBackup) into an EMPTY Nexus
 * database, giving every record to ownerId, who must be registered there as
 * an owner. All or nothing: one transaction, undone on any problem.
 *
 * 1. Records go in with every database rule active, so each note's document,
 *    links and searchable text are checked by the database itself, and every
 *    link between records is enforced.
 * 2. The rules set fresh dates and revisions on insert, so the original ones
 *    are then put back, with the rules paused for that one step only
 *    (session_replication_role, as standard PostgreSQL restores do).
 * 3. Everything is read back and must equal the backup exactly, including
 *    the searchable text the database derived in step 1. Otherwise nothing
 *    is kept.
 */
export async function restoreBackup(db, backup, ownerId) {
  const { data } = backup
  await db.query('begin')
  try {
    await checkStructure(db)

    const { rows: existing } = await db.query(
      `select (select count(*) from public.contexts) + (select count(*) from public.tasks)
            + (select count(*) from public.notes) as records`,
    )
    if (Number(existing[0].records) !== 0) {
      throw new BackupProblem(
        'The database to restore into already holds contexts, tasks or notes. A restore only ever goes into an empty database, so nothing is overwritten.',
      )
    }
    const { rows: owner } = await db.query(
      `select 1 from private.identities where user_id = $1::uuid and kind = 'owner'`,
      [ownerId],
    )
    if (owner.length !== 1) {
      throw new BackupProblem('The account to restore for is not registered as an owner in that database.')
    }

    for (const table of TABLE_NAMES) await insertRows(db, table, data[table], ownerId)

    await db.query('set local session_replication_role = replica')
    for (const table of TABLE_NAMES) await putBackRuleColumns(db, table, data[table], ownerId)
    await db.query('set local session_replication_role = origin')

    const restored = await readTables(db, ownerId)
    const difference = describeDifference(data, restored)
    if (difference) {
      throw new BackupProblem(`The restored records do not match the backup (${difference}). Nothing was kept.`)
    }

    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    if (error instanceof BackupProblem) throw error
    throw new BackupProblem(`The database refused the restore (${error.message}). Nothing was kept.`, { cause: error })
  }
}
