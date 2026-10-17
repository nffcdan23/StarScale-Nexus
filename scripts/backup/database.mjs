// NEXUS-ADMIN-ONLY: reads a backup out of a Nexus database and restores one
// into an empty Nexus database. Never imported by the app.
//
// Works with any client that has query(sql, params) returning { rows }: the
// PostgreSQL client (pg) on the Windows PC, or PGlite for the throwaway
// databases that prove a backup can be restored.

import { BackupProblem, canonicalJson, FORMAT_VERSION, LAYOUTS, TABLE_NAMES, TABLES } from './format.mjs'

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

async function columnsByTable(db) {
  const { rows } = await db.query(`
    select table_name::text as table_name, column_name::text as column_name
    from information_schema.columns
    where table_schema = 'public' and table_name in ('contexts', 'projects', 'tasks', 'notes')
  `)
  const found = {}
  for (const row of rows) (found[row.table_name] ??= []).push(row.column_name)
  return found
}

function layoutMismatch(found, layout) {
  const problems = []
  for (const [table, spec] of Object.entries(LAYOUTS[layout])) {
    const actual = found[table] ?? []
    const expected = ['owner_id', ...Object.keys(spec.columns), ...spec.derived]
    const unexpected = actual.filter((column) => !expected.includes(column))
    const missing = expected.filter((column) => !actual.includes(column))
    if (actual.length === 0) problems.push(`the ${table} table is missing`)
    else if (unexpected.length > 0 || missing.length > 0) {
      const parts = [
        unexpected.length > 0 ? `columns this tool does not know: ${unexpected.join(', ')}` : '',
        missing.length > 0 ? `missing columns: ${missing.join(', ')}` : '',
      ].filter(Boolean)
      problems.push(`the ${table} table does not match (${parts.join('; ')})`)
    }
  }
  const extra = Object.keys(found).filter((table) => !(table in LAYOUTS[layout]))
  if (extra.length > 0) problems.push(`tables this layout does not have: ${extra.join(', ')}`)
  return problems
}

/**
 * Which backup layout the database has (see LAYOUTS in format.mjs): 2 once
 * projects exist, 1 before. Refuses anything else, so a column this tool
 * does not know is never silently left out.
 */
export async function detectLayout(db) {
  const found = await columnsByTable(db)
  for (const layout of [FORMAT_VERSION, 1]) {
    if (layoutMismatch(found, layout).length === 0) return layout
  }
  throw new BackupProblem(
    `The database does not match what the backup tool knows (${layoutMismatch(found, FORMAT_VERSION).join('; ')}). ` +
      'The tool must be updated with the database before it can be used.',
  )
}

/** Refuses a database whose tables are not exactly the given layout (the current one by default). */
export async function checkStructure(db, layout = FORMAT_VERSION) {
  const problems = layoutMismatch(await columnsByTable(db), layout)
  if (problems.length > 0) {
    throw new BackupProblem(
      `The database does not match what the backup tool knows (${problems.join('; ')}). ` +
        'The tool must be updated with the database before it can be used.',
    )
  }
}

/**
 * The owner's records, exactly as stored, without the owner's account id and
 * without derived columns, in the given layout. Must run inside a
 * transaction: times are read in UTC so the same moment always looks the same.
 */
export async function readTables(db, ownerId, layout = FORMAT_VERSION) {
  await db.query(`set local timezone to 'UTC'`)
  const data = {}
  for (const [table, spec] of Object.entries(LAYOUTS[layout])) {
    const omit = ['owner_id', ...spec.derived].map((column) => `'${column}'`).join(', ')
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
 * Returns { data, migrations, otherRecords, layout }: otherRecords counts
 * records that belong to other accounts and are therefore not included;
 * layout is the format the data is in (1 before projects, 2 after).
 */
export async function readBackupData(db, { ownerId }) {
  await db.query('begin transaction isolation level repeatable read read only')
  try {
    const layout = await detectLayout(db)
    const data = await readTables(db, ownerId, layout)
    const migrations = await readMigrations(db)
    const others = Object.keys(LAYOUTS[layout])
      .map((table) => `(select count(*) from public.${table} where owner_id <> $1::uuid)`)
      .join(' + ')
    const { rows } = await db.query(`select ${others} as other_records`, [ownerId])
    await db.query('commit')
    return { data, migrations, otherRecords: Number(rows[0].other_records), layout }
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
 */
export async function restoreBackup(db, backup, ownerId) {
  await db.query('begin')
  try {
    await restoreRecords(db, backup, ownerId)
    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw asBackupProblem(error)
  }
}

/** Database errors in plain words; problems already worded pass through. */
export function asBackupProblem(error) {
  if (error instanceof BackupProblem) return error
  return new BackupProblem(`The database refused the restore (${error.message}). Nothing was kept.`, { cause: error })
}

/**
 * The restore itself, inside a transaction the caller owns: restoreBackup
 * commits it; the cloud restore drill always undoes it.
 *
 * emptyScope 'database' (every real restore) refuses unless contexts, tasks
 * and notes are all empty. 'owner' is only for the drill, which restores
 * fictional records for a stand-in owner inside a transaction that is always
 * rolled back, in a project that may already hold real records.
 *
 * 1. Records go in with every database rule active, so each note's document,
 *    links and searchable text are checked by the database itself, and every
 *    link between records is enforced.
 * 2. The rules set fresh dates and revisions on insert, so the original ones
 *    are then put back, with the rules paused for that one step only
 *    (session_replication_role, as standard PostgreSQL restores do).
 * 3. Everything is read back and must equal the backup exactly, including
 *    the searchable text the database derived in step 1.
 */
export async function restoreRecords(db, backup, ownerId, { emptyScope = 'database' } = {}) {
  const { data } = backup
  await checkStructure(db)

  const ownerOnly = emptyScope === 'owner'
  const existingSql = TABLE_NAMES.map(
    (table) => `(select count(*) from public.${table} where $1::uuid is null or owner_id = $1::uuid)`,
  ).join(' + ')
  const { rows: existing } = await db.query(`select ${existingSql} as records`, [ownerOnly ? ownerId : null])
  if (Number(existing[0].records) !== 0) {
    throw new BackupProblem(
      ownerOnly
        ? 'The stand-in owner already holds records. Nothing was restored.'
        : 'The database to restore into already holds contexts, projects, tasks or notes. A restore only ever goes into an empty database, so nothing is overwritten.',
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
  await checkOwnership(db, ownerId)
}

/**
 * After a restore: every project, task and note belongs to the owner restored
 * for, and every link between them stays within that owner. The database's
 * same-owner rules already enforce this; it is checked again, explicitly.
 */
async function checkOwnership(db, ownerId) {
  const { rows } = await db.query(
    `select
       (select count(*) from public.notes n join public.projects p on p.id = n.project_id
         where n.owner_id = $1::uuid and p.owner_id <> n.owner_id)
     + (select count(*) from public.tasks t join public.projects p on p.id = t.project_id
         where t.owner_id = $1::uuid and p.owner_id <> t.owner_id)
     + (select count(*) from public.tasks t join public.contexts c on c.id = t.context_id
         where t.owner_id = $1::uuid and c.owner_id <> t.owner_id)
     + (select count(*) from public.notes n join public.contexts c on c.id = n.context_id
         where n.owner_id = $1::uuid and c.owner_id <> n.owner_id)
     + (select count(*) from public.projects p join public.contexts c on c.id = p.context_id
         where p.owner_id = $1::uuid and c.owner_id <> p.owner_id) as crossed`,
    [ownerId],
  )
  if (Number(rows[0].crossed) !== 0) {
    throw new BackupProblem('A restored record points at another owner’s context or project. Nothing was kept.')
  }
}

/**
 * Whether two backups (already checked by readBackup, so in the current
 * format) hold exactly the same records: every context, project, task and
 * note in the first is in the second, unchanged, and nothing was added.
 * Returns the first difference in words, or null.
 */
export function compareBackups(before, after) {
  return describeDifference(before.data, after.data)
}
