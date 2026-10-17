// NEXUS-ADMIN-ONLY: the Nexus backup file format. Never imported by the app;
// the build fails if this marker ever appears in the app files.
//
// A backup is one JSON file holding the owner's contexts, tasks and notes,
// exactly as the database stores them (ids, dates, revisions, formatting and
// the links between them). It never holds anything from sign-in: no account
// ids, email addresses, passwords, sessions, tokens or authenticator secrets.
//
// Two fingerprints (SHA-256) guard it:
//   dataFingerprint  the records alone. Two backups of unchanged data share it.
//   integrity        the whole file. Any change after saving is detected.
// They detect damage and accidental edits. They are not a signature: someone
// who deliberately edits the file and recomputes them is not stopped, so
// backups must be kept where only the owner can reach them.

import { createHash } from 'node:crypto'

export const FORMAT = 'starscale-nexus-backup'
/** The format new backups are written in. Format 1 backups are still read. */
export const FORMAT_VERSION = 2

const contextsTable = {
  columns: {
    id: 'uuid',
    name: 'text',
    slug: 'text',
    show_on_tv: 'boolean',
    created_at: 'timestamptz',
    updated_at: 'timestamptz',
    archived_at: 'timestamptz',
  },
  derived: [],
  setByRules: [],
}

const tasksColumnsV1 = {
  id: 'uuid',
  context_id: 'uuid',
  title: 'text',
  notes: 'text',
  status: 'text',
  priority: 'text',
  due_at: 'timestamptz',
  due_on: 'date',
  hide_from_tv: 'boolean',
  origin: 'text',
  source: 'text',
  external_id: 'text',
  completed_at: 'timestamptz',
  created_at: 'timestamptz',
  updated_at: 'timestamptz',
  archived_at: 'timestamptz',
}

const notesColumnsV1 = {
  id: 'uuid',
  context_id: 'uuid',
  title: 'text',
  content: 'jsonb',
  content_text: 'text',
  pinned: 'boolean',
  revision: 'integer',
  created_at: 'timestamptz',
  updated_at: 'timestamptz',
  archived_at: 'timestamptz',
}

/**
 * Exactly what a backup holds, table by table, in restore order, with each
 * column's database type, for each database layout:
 *   1  before projects (migrations up to 20261017090000_notes);
 *   2  with projects (20261018090000_projects), the current layout.
 * Left out on purpose:
 *   owner_id  a restore gives the rows to the owner of the database it
 *             restores into (account ids differ between databases);
 *   derived   columns the database computes itself (note preview and search).
 * setByRules lists the columns the database's write rules set on every
 * insert; a restore puts the original values back afterwards.
 *
 * When a migration changes one of these tables, a new layout and format are
 * added in the same commit, with the upgrade of older backups. The tools
 * refuse a database whose columns match no layout, so nothing can be
 * silently left out.
 */
export const LAYOUTS = {
  1: {
    contexts: contextsTable,
    tasks: { columns: tasksColumnsV1, derived: [], setByRules: ['completed_at', 'updated_at'] },
    notes: { columns: notesColumnsV1, derived: ['preview', 'search'], setByRules: ['revision', 'created_at', 'updated_at'] },
  },
  2: {
    contexts: contextsTable,
    projects: {
      columns: {
        id: 'uuid',
        name: 'text',
        context_id: 'uuid',
        created_at: 'timestamptz',
        updated_at: 'timestamptz',
        archived_at: 'timestamptz',
      },
      derived: [],
      setByRules: [],
    },
    tasks: { columns: { ...tasksColumnsV1, project_id: 'uuid' }, derived: [], setByRules: ['completed_at', 'updated_at'] },
    notes: {
      columns: { ...notesColumnsV1, project_id: 'uuid' },
      derived: ['preview', 'search'],
      setByRules: ['revision', 'created_at', 'updated_at'],
    },
  },
}

/** The current layout: what restores write and what new backups hold. */
export const TABLES = LAYOUTS[FORMAT_VERSION]

export const TABLE_NAMES = Object.keys(TABLES)

/** A problem the owner should read: the message is plain English. */
export class BackupProblem extends Error {}

/** JSON with every object's keys sorted, so the same data always gives the same text. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function dataFingerprint(data) {
  return sha256(canonicalJson(data))
}

/** For example "1 context, 12 tasks, 3 notes". */
export function describeCounts(counts) {
  const words = { contexts: ['context', 'contexts'], projects: ['project', 'projects'], tasks: ['task', 'tasks'], notes: ['note', 'notes'] }
  return Object.keys(words)
    .filter((table) => table in counts)
    .map((table) => `${counts[table]} ${words[table][counts[table] === 1 ? 0 : 1]}`)
    .join(', ')
}

/** The short form shown to the owner. */
export function shortFingerprint(fingerprint) {
  return fingerprint.slice(0, 12)
}

function integrityOf(body) {
  return sha256(canonicalJson(body))
}

/**
 * A complete backup, ready to save. formatVersion is the layout the data was
 * read in: 2 normally, 1 for a database not yet given projects.
 * source: { environment: 'local', migrations: ['20261013120000', ...] }
 */
export function createBackup({ data, source, createdAt = new Date(), formatVersion = FORMAT_VERSION }) {
  if (!LAYOUTS[formatVersion]) throw new BackupProblem(`There is no backup format version ${formatVersion}.`)
  const body = {
    format: FORMAT,
    formatVersion,
    createdAt: createdAt.toISOString(),
    source,
    counts: Object.fromEntries(Object.keys(LAYOUTS[formatVersion]).map((table) => [table, data[table].length])),
    dataFingerprint: dataFingerprint(data),
    data,
  }
  return { ...body, integrity: integrityOf(body) }
}

const TOP_LEVEL_KEYS = ['format', 'formatVersion', 'createdAt', 'source', 'counts', 'dataFingerprint', 'data', 'integrity']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Basic shape only; the database's own rules judge the values during a restore. */
function valueFits(type, value) {
  if (value === null) return true
  switch (type) {
    case 'uuid':
      return typeof value === 'string' && UUID.test(value)
    case 'text':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      return Number.isInteger(value)
    case 'timestamptz':
      return typeof value === 'string' && TIMESTAMP.test(value)
    case 'date':
      return typeof value === 'string' && DATE.test(value)
    case 'jsonb':
      return isPlainObject(value)
    default:
      return false
  }
}

function sameKeys(actual, expected) {
  return actual.length === expected.length && expected.every((key) => actual.includes(key))
}

/**
 * Reads a saved backup and refuses anything damaged, edited, incomplete or
 * not understood. Returns the backup only if every check passes.
 */
export function readBackup(text) {
  let backup
  try {
    backup = JSON.parse(text)
  } catch {
    throw new BackupProblem('The file is damaged or incomplete: it cannot be read as a Nexus backup. Do not use it.')
  }
  if (!isPlainObject(backup) || backup.format !== FORMAT) {
    throw new BackupProblem('This is not a StarScale Nexus backup file.')
  }
  const layout = LAYOUTS[backup.formatVersion]
  if (!layout) {
    throw new BackupProblem(
      `This backup uses format version ${String(backup.formatVersion)}, which this version of Nexus does not know.`,
    )
  }
  if (!sameKeys(Object.keys(backup), TOP_LEVEL_KEYS)) {
    throw new BackupProblem('The file is damaged: its layout is not that of a Nexus backup. Do not use it.')
  }

  const { integrity, ...body } = backup
  if (typeof integrity !== 'string' || integrityOf(body) !== integrity) {
    throw new BackupProblem('The file has changed since it was made (it is damaged or was edited). Do not use it.')
  }

  // The fingerprints match, so from here on a problem means the file was
  // made wrongly, not damaged afterwards.
  const { data, counts, source } = backup
  const tableNames = Object.keys(layout)
  if (!isPlainObject(source) || !Array.isArray(source.migrations) || typeof source.environment !== 'string') {
    throw new BackupProblem('The backup does not say where it came from. Do not use it.')
  }
  if (!isPlainObject(data) || !sameKeys(Object.keys(data), tableNames) || !isPlainObject(counts)) {
    throw new BackupProblem(`The backup does not hold exactly ${tableNames.join(', ')}. Do not use it.`)
  }
  if (dataFingerprint(data) !== backup.dataFingerprint) {
    throw new BackupProblem("The backup's records do not match its data fingerprint. Do not use it.")
  }

  const ids = {}
  for (const table of tableNames) {
    const rows = data[table]
    const columns = layout[table].columns
    if (!Array.isArray(rows) || rows.length !== counts[table]) {
      throw new BackupProblem(`The number of ${table} in the backup does not match its record count. Do not use it.`)
    }
    ids[table] = new Set()
    for (const row of rows) {
      if (!isPlainObject(row) || !sameKeys(Object.keys(row), Object.keys(columns))) {
        throw new BackupProblem(`A record in ${table} does not have the expected fields. Do not use this backup.`)
      }
      for (const [column, type] of Object.entries(columns)) {
        if (!valueFits(type, row[column])) {
          throw new BackupProblem(`${table} record ${String(row.id)} has an unexpected value in ${column}. Do not use this backup.`)
        }
      }
      if (row.id === null || ids[table].has(row.id)) {
        throw new BackupProblem(`${table} record ${String(row.id)} is missing an id or appears twice. Do not use this backup.`)
      }
      ids[table].add(row.id)
    }
  }

  // Every link between records must point at a record in the same backup.
  const linked = (table, row, column, target) => {
    if (row[column] !== null && !ids[target].has(row[column])) {
      const what = target === 'contexts' ? 'a context' : 'a project'
      throw new BackupProblem(`${table} record ${row.id} belongs to ${what} that is not in the backup. Do not use this backup.`)
    }
  }
  for (const task of data.tasks) {
    if (!ids.contexts.has(task.context_id)) {
      throw new BackupProblem(`Task ${task.id} belongs to a context that is not in the backup. Do not use this backup.`)
    }
    if ('project_id' in task) linked('Task', task, 'project_id', 'projects')
  }
  for (const note of data.notes) {
    if (note.context_id !== null && !ids.contexts.has(note.context_id)) {
      throw new BackupProblem(`Note ${note.id} belongs to a context that is not in the backup. Do not use this backup.`)
    }
    if ('project_id' in note) linked('Note', note, 'project_id', 'projects')
  }
  for (const project of data.projects ?? []) linked('Project', project, 'context_id', 'contexts')

  return backup.formatVersion === FORMAT_VERSION ? backup : upgrade(backup)
}

/**
 * A format 1 backup in the current format, in memory only: no projects, and
 * every task and note in no project (the Inbox), exactly as the projects
 * migration leaves existing records. The file itself is never changed.
 */
function upgrade(backup) {
  const data = {
    contexts: backup.data.contexts,
    projects: [],
    tasks: backup.data.tasks.map((task) => ({ ...task, project_id: null })),
    notes: backup.data.notes.map((note) => ({ ...note, project_id: null })),
  }
  return {
    ...backup,
    formatVersion: FORMAT_VERSION,
    upgradedFrom: backup.formatVersion,
    counts: Object.fromEntries(TABLE_NAMES.map((table) => [table, data[table].length])),
    dataFingerprint: dataFingerprint(data),
    data,
  }
}
