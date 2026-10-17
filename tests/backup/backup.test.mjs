// Backup and restore tools (Phase 3c-4b-1), with fictional data only, in
// throwaway in-memory databases (PGlite) built from the project's migrations.
// Runs on any computer: npm run test:backup.

import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { compareBackups, readBackupData, restoreBackup } from '../../scripts/backup/database.mjs'
import { newestBackup, saveBackup, syncFolderWarning } from '../../scripts/backup/files.mjs'
import { createBackup, readBackup, TABLE_NAMES, TABLES } from '../../scripts/backup/format.mjs'
import { verifyBackup } from '../../scripts/backup/verify.mjs'
import { loadMigrations } from '../security/lib/migrations.mjs'
import { projectRoot } from '../security/lib/paths.mjs'
import { createMockDatabase } from '../security/mock/pglite-database.mjs'
import { addFictionalHistory, fictional, registerOwner, richNote } from './fictional-data.mjs'

const OWNER = fictional.owner
const OTHER_OWNER = fictional.otherOwner
const { work: WORK, home: HOME, taskDone: TASK_DONE, taskDateOnly: TASK_DATE_ONLY } = fictional
const { noteRich: NOTE_RICH, noteLoose: NOTE_LOOSE, noteArchived: NOTE_ARCHIVED, noteEdited: NOTE_EDITED } = fictional

const migrations = await loadMigrations()
// Databases made inside a test close after it; ones a group shares close at the end.
const open = []
const shared = []

afterEach(async () => {
  while (open.length > 0) await open.pop().close()
})

afterAll(async () => {
  while (shared.length > 0) await shared.pop().close()
})

function keep(db) {
  open.splice(open.indexOf(db), 1)
  shared.push(db)
  return db
}

async function database() {
  const db = await createMockDatabase(migrations)
  open.push(db)
  return db
}

/** A database with the fictional history: old dates, edits, archives, every task and note shape. */
async function sourceDatabase() {
  const db = await database()
  await addFictionalHistory(db)
  return db
}

async function emptyDatabase(ownerId = randomUUID()) {
  const db = await database()
  await registerOwner(db, ownerId, 'Fictional restore target')
  return { db, ownerId }
}

async function makeBackup(db) {
  const { data, migrations: versions } = await readBackupData(db, { ownerId: OWNER })
  return createBackup({ data, source: { environment: 'local', migrations: versions } })
}

/** A deliberately altered copy with fresh fingerprints, as a faulty tool might make. */
function altered(backup, change) {
  const data = structuredClone(backup.data)
  change(data)
  return createBackup({ data, source: backup.source, createdAt: new Date(backup.createdAt) })
}

async function recordCount(db) {
  const { rows } = await db.query(
    `select (select count(*) from public.contexts) + (select count(*) from public.tasks) + (select count(*) from public.notes) as n`,
  )
  return Number(rows[0].n)
}

describe('backing up (fictional data)', () => {
  let source
  let backup

  beforeAll(async () => {
    source = keep(await sourceDatabase())
    backup = await makeBackup(source)
  })

  it("holds exactly the owner's contexts, projects, tasks and notes, and nothing from sign-in", async () => {
    expect(backup.formatVersion).toBe(2)
    expect(backup.counts).toEqual({ contexts: 2, projects: 2, tasks: 5, notes: 4 })
    for (const table of TABLE_NAMES) {
      for (const row of backup.data[table]) expect(Object.keys(row).sort()).toEqual(Object.keys(TABLES[table].columns).sort())
    }
    const text = JSON.stringify(backup)
    expect(text).not.toContain(OWNER)
    expect(text).not.toContain(OTHER_OWNER)
    expect(text).not.toContain('Other account')
    expect(text).not.toMatch(/owner_id|password|email|secret|factor|token|session/i)

    const { otherRecords } = await readBackupData(source, { ownerId: OWNER })
    expect(otherRecords).toBe(3)
  })

  it('reads in one read-only transaction and never writes', async () => {
    const statements = []
    const recorder = { query: (sql, params) => (statements.push(sql), source.query(sql, params)) }
    const before = await makeBackup(source)
    await readBackupData(recorder, { ownerId: OWNER })
    const after = await makeBackup(source)

    expect(statements[0]).toMatch(/^begin transaction isolation level repeatable read read only$/)
    expect(statements.at(-1)).toBe('commit')
    for (const sql of statements) expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create|grant)\b/i)
    expect(after.dataFingerprint).toBe(before.dataFingerprint)
  })

  it('keeps dates to the microsecond and in UTC', () => {
    const done = backup.data.tasks.find((task) => task.id === TASK_DONE)
    expect(done.completed_at).toBe('2026-10-10T16:45:12.345678+00:00')
    expect(backup.data.tasks.find((task) => task.id === TASK_DATE_ONLY).due_on).toBe('2026-10-24')
    expect(backup.data.notes.find((note) => note.id === NOTE_EDITED).revision).toBe(3)
  })

  it('refuses a database whose tables have columns the tool does not know', async () => {
    const db = await sourceDatabase()
    await db.exec('alter table public.notes add column mood text')
    await expect(readBackupData(db, { ownerId: OWNER })).rejects.toThrow(/columns this tool does not know: mood/)
  })
})

describe('restoring (fictional data)', () => {
  let backup

  beforeAll(async () => {
    backup = await makeBackup(await sourceDatabase())
  })

  it('a saved backup restores identically into a disposable database', async () => {
    const result = await verifyBackup(readBackup(JSON.stringify(backup, null, 2)))
    expect(result.fingerprint).toBe(backup.dataFingerprint)
    expect(result.counts).toEqual(backup.counts)
  })

  it('keeps formatting, dates, revisions and links between records, for the new owner', async () => {
    const { db, ownerId } = await emptyDatabase()
    await restoreBackup(db, backup, ownerId)

    const { rows: notes } = await db.query(
      `select id, owner_id, context_id, content, content_text, preview, revision, pinned,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as created,
              to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as updated,
              archived_at is not null as archived
       from public.notes order by id`,
    )
    const rich = notes.find((note) => note.id === NOTE_RICH)
    expect(rich.content).toEqual(richNote.doc)
    expect(rich.content_text).toBe(richNote.text)
    expect(rich.preview).toBe(richNote.text.slice(0, 200))
    expect(rich.context_id).toBe(WORK)
    expect(rich.pinned).toBe(true)
    expect(notes.find((note) => note.id === NOTE_LOOSE).context_id).toBeNull()
    expect(notes.find((note) => note.id === NOTE_ARCHIVED).archived).toBe(true)
    const edited = notes.find((note) => note.id === NOTE_EDITED)
    expect(edited).toMatchObject({ revision: 3, created: '2026-09-10T07:00:00.500000', updated: '2026-10-01T18:20:00.654321' })
    expect(new Set(notes.map((note) => note.owner_id))).toEqual(new Set([ownerId]))

    const { rows: tasks } = await db.query(
      `select id, context_id, owner_id, status,
              to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as completed
       from public.tasks order by id`,
    )
    expect(tasks.find((task) => task.id === TASK_DONE)).toMatchObject({ context_id: HOME, completed: '2026-10-10T16:45:12.345678' })
    expect(new Set(tasks.map((task) => task.owner_id))).toEqual(new Set([ownerId]))

    // Search works on restored notes, because the database rebuilt its index.
    await db.exec(`set request.jwt.claims = '{"sub": "${ownerId}", "aal": "aal2", "role": "authenticated"}'`)
    await db.exec('set role authenticated')
    const { rows: found } = await db.query(`select id from public.search_notes('plan')`)
    expect(found.map((row) => row.id)).toContain(NOTE_RICH)
  })

  it('refuses a database that already holds records, and changes nothing there', async () => {
    const target = await sourceDatabase()
    const before = await makeBackup(target)
    await expect(restoreBackup(target, backup, OWNER)).rejects.toThrow(/already holds contexts, projects, tasks or notes/)
    expect((await makeBackup(target)).dataFingerprint).toBe(before.dataFingerprint)
  })

  it('refuses an account that is not a registered owner', async () => {
    const { db } = await emptyDatabase()
    await expect(restoreBackup(db, backup, randomUUID())).rejects.toThrow(/not registered as an owner/)
  })

  it('keeps nothing if any record breaks a database rule', async () => {
    const unsafe = altered(backup, (data) => {
      const note = data.notes.find((candidate) => candidate.id === NOTE_LOOSE)
      note.content = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }],
      }
    })
    const { db, ownerId } = await emptyDatabase()
    await expect(restoreBackup(db, readBackup(JSON.stringify(unsafe)), ownerId)).rejects.toThrow(/refused the restore.*links/)
    expect(await recordCount(db)).toBe(0)
  })

  it('keeps nothing if a note\'s searchable text disagrees with the note', async () => {
    const forged = altered(backup, (data) => {
      data.notes.find((note) => note.id === NOTE_RICH).content_text = 'Something the note does not say'
    })
    const { db, ownerId } = await emptyDatabase()
    await expect(restoreBackup(db, forged, ownerId)).rejects.toThrow(/content_text differs after restoring/)
    expect(await recordCount(db)).toBe(0)
  })

  it('refuses a backup made with migrations this project does not have', async () => {
    const newer = createBackup({ data: backup.data, source: { environment: 'local', migrations: ['29991231000000'] } })
    await expect(verifyBackup(newer)).rejects.toThrow(/migrations this project does not have/)
  })
})

describe('checking a backup file', () => {
  let text

  beforeAll(async () => {
    text = JSON.stringify(await makeBackup(await sourceDatabase()), null, 2)
  })

  it('accepts an intact file, whatever its line endings', () => {
    expect(readBackup(text).counts.notes).toBe(4)
    expect(readBackup(text.replace(/\n/g, '\r\n')).counts.notes).toBe(4)
  })

  it('rejects a file changed by even one character', () => {
    expect(() => readBackup(text.replace('Fictional Work', 'Fictional Wark'))).toThrow(/changed since it was made/)
    expect(() => readBackup(text.replace('"revision": 3', '"revision": 4'))).toThrow(/changed since it was made/)
  })

  it('rejects an incomplete file and anything that is not a Nexus backup', () => {
    expect(() => readBackup(text.slice(0, Math.floor(text.length / 2)))).toThrow(/damaged or incomplete/)
    expect(() => readBackup('{"hello": "world"}')).toThrow(/not a StarScale Nexus backup/)
    expect(() => readBackup(text.replace('"formatVersion": 2', '"formatVersion": 3'))).toThrow(/format version 3/)
  })

  it('rejects records whose links point outside the backup', () => {
    const backup = readBackup(text)
    const broken = altered(backup, (data) => {
      data.tasks[0].context_id = randomUUID()
    })
    expect(() => readBackup(JSON.stringify(broken))).toThrow(/context that is not in the backup/)
  })
})

describe('saving backups', () => {
  let dir

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexus-backup-test-'))
    return () => rm(dir, { recursive: true, force: true })
  })

  it('saves a checked file, never replaces one, and finds the newest', async () => {
    const backup = await makeBackup(await sourceDatabase())
    const first = await saveBackup(backup, { environment: 'local', dir, now: new Date(2026, 9, 17, 10, 30, 15) })
    const second = await saveBackup(backup, { environment: 'local', dir, now: new Date(2026, 9, 17, 11, 0, 0) })
    expect(first).toMatch(/nexus-local-2026-10-17-103015\.json$/)
    expect(readBackup(await readFile(first, 'utf8')).dataFingerprint).toBe(backup.dataFingerprint)

    await expect(saveBackup(backup, { environment: 'local', dir, now: new Date(2026, 9, 17, 10, 30, 15) })).rejects.toThrow(
      /already exists/,
    )
    expect((await readdir(dir)).filter((name) => name.endsWith('.partial'))).toEqual([])

    await writeFile(join(dir, 'nexus-local-2099-01-01-000000.json.partial'), 'unfinished')
    await writeFile(join(dir, 'notes.txt'), 'not a backup')
    expect(await newestBackup(dir)).toBe(second)
    expect(await newestBackup(join(dir, 'missing'))).toBeNull()
  })

  it('keeps the backups folder out of Git and warns about synced folders', async () => {
    const gitignore = (await readFile(join(projectRoot, '.gitignore'), 'utf8')).split(/\r?\n/)
    expect(gitignore).toContain('backups/')
    expect(syncFolderWarning('C:\\Users\\Fictional\\OneDrive\\Documents\\StarScale Nexus\\backups')).toMatch(/OneDrive/)
    expect(syncFolderWarning('C:\\Users\\Fictional\\Projects\\StarScale Nexus\\backups')).toBeNull()
  })
})

describe('projects in backups (format 2)', () => {
  it('restores projects and every link to them exactly, for the new owner', async () => {
    const backup = await makeBackup(await sourceDatabase())
    const { db, ownerId } = await emptyDatabase()
    await restoreBackup(db, backup, ownerId)
    const { rows: projects } = await db.query(
      `select id, owner_id, name, context_id, archived_at is not null as archived,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as created
       from public.projects order by id`,
    )
    expect(projects).toEqual([
      { id: fictional.projectLaunch, owner_id: ownerId, name: 'Fictional launch', context_id: WORK, archived: false, created: '2026-09-02T10:00:00.250000' },
      { id: fictional.projectOld, owner_id: ownerId, name: 'Old fictional project', context_id: null, archived: true, created: '2026-08-01T10:00:00.000000' },
    ])
    const { rows: links } = await db.query(
      `select 'note' as kind, id, project_id from public.notes where project_id is not null
       union all select 'task', id, project_id from public.tasks where project_id is not null order by 2`,
    )
    expect(links).toEqual([
      { kind: 'task', id: fictional.taskTimed, project_id: fictional.projectLaunch },
      { kind: 'note', id: NOTE_RICH, project_id: fictional.projectLaunch },
      { kind: 'note', id: NOTE_ARCHIVED, project_id: fictional.projectOld },
    ])
  })

  it('rejects links to projects, or a project context, outside the backup', async () => {
    const backup = await makeBackup(await sourceDatabase())
    const noteOut = altered(backup, (data) => {
      data.notes.find((note) => note.id === NOTE_LOOSE).project_id = randomUUID()
    })
    expect(() => readBackup(JSON.stringify(noteOut))).toThrow(/Note record .* belongs to a project that is not in the backup/)
    const taskOut = altered(backup, (data) => {
      data.tasks[1].project_id = randomUUID()
    })
    expect(() => readBackup(JSON.stringify(taskOut))).toThrow(/Task record .* belongs to a project that is not in the backup/)
    const projectOut = altered(backup, (data) => {
      data.projects[0].context_id = randomUUID()
    })
    expect(() => readBackup(JSON.stringify(projectOut))).toThrow(/Project record .* belongs to a context that is not in the backup/)
  })
})

describe('backups made before projects existed (format 1)', () => {
  const beforeProjects = migrations.filter((migration) => !migration.name.includes('_projects'))
  const projectsMigration = migrations.find((migration) => migration.name.includes('_projects'))

  async function databaseBeforeProjects() {
    const db = await createMockDatabase(beforeProjects)
    open.push(db)
    await registerOwner(db, OWNER, 'Fictional owner')
    await db.exec(`
      insert into public.contexts (id, owner_id, name, slug, created_at, updated_at) values
        ('${WORK}', '${OWNER}', 'Fictional Work', 'work', '2026-09-01T08:00:00.123456Z', '2026-09-02T09:30:00Z');
      insert into public.tasks (id, owner_id, context_id, title, status) values
        ('${TASK_DONE}', '${OWNER}', '${WORK}', 'Finished fictional errand', 'done');
      insert into public.notes (id, owner_id, context_id, title, content) values
        ('${NOTE_RICH}', '${OWNER}', '${WORK}', 'Fictional plan', '${JSON.stringify(richNote.doc).replaceAll("'", "''")}');`)
    return db
  }

  it('are made in format 1 by a database without projects, and still restore', async () => {
    const db = await databaseBeforeProjects()
    const { data, migrations: versions, layout } = await readBackupData(db, { ownerId: OWNER })
    expect(layout).toBe(1)
    const file = createBackup({ data, source: { environment: 'local', migrations: versions }, formatVersion: 1 })
    expect(file.formatVersion).toBe(1)
    expect(Object.keys(file.data)).toEqual(['contexts', 'tasks', 'notes'])

    const read = readBackup(JSON.stringify(file, null, 2))
    expect(read).toMatchObject({ formatVersion: 2, upgradedFrom: 1, counts: { contexts: 1, projects: 0, tasks: 1, notes: 1 } })
    expect(read.data.notes[0].project_id).toBeNull()
    expect(read.data.tasks[0].project_id).toBeNull()
    const result = await verifyBackup(read)
    expect(result.fingerprint).toBe(read.dataFingerprint)
  })

  it('prove the projects migration changes no existing record', async () => {
    const db = await databaseBeforeProjects()
    const first = await readBackupData(db, { ownerId: OWNER })
    const before = createBackup({ data: first.data, source: { environment: 'local', migrations: [] }, formatVersion: first.layout })
    await db.exec(projectsMigration.sql)
    const second = await readBackupData(db, { ownerId: OWNER })
    expect(second.layout).toBe(2)
    const after = createBackup({ data: second.data, source: { environment: 'local', migrations: [] }, formatVersion: second.layout })
    expect(compareBackups(readBackup(JSON.stringify(before)), readBackup(JSON.stringify(after)))).toBeNull()

    // And a real change is noticed.
    await db.exec(`update public.notes set pinned = true where id = '${NOTE_RICH}'`)
    const third = await readBackupData(db, { ownerId: OWNER })
    const changed = createBackup({ data: third.data, source: { environment: 'local', migrations: [] } })
    expect(compareBackups(readBackup(JSON.stringify(after)), readBackup(JSON.stringify(changed)))).toMatch(/notes record .*: pinned differs/)
  })

  it('refuse a database that matches neither layout', async () => {
    const db = await databaseBeforeProjects()
    await db.exec('alter table public.tasks add column project_id uuid')
    await expect(readBackupData(db, { ownerId: OWNER })).rejects.toThrow(/does not match what the backup tool knows/)
  })
})
