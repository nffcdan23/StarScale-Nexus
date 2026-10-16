// Backup and restore tools (Phase 3c-4b-1), with fictional data only, in
// throwaway in-memory databases (PGlite) built from the project's migrations.
// Runs on any computer: npm run test:backup.

import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readBackupData, restoreBackup } from '../../scripts/backup/database.mjs'
import { newestBackup, saveBackup, syncFolderWarning } from '../../scripts/backup/files.mjs'
import { createBackup, readBackup, TABLE_NAMES, TABLES } from '../../scripts/backup/format.mjs'
import { verifyBackup } from '../../scripts/backup/verify.mjs'
import { loadMigrations } from '../security/lib/migrations.mjs'
import { projectRoot } from '../security/lib/paths.mjs'
import { createMockDatabase } from '../security/mock/pglite-database.mjs'

const richNote = JSON.parse(await readFile(join(projectRoot, 'tests', 'security', 'lib', 'rich-note.json'), 'utf8'))

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222'
const WORK = 'a0000000-0000-4000-8000-000000000001'
const HOME = 'a0000000-0000-4000-8000-000000000002'
const OTHER_CONTEXT = 'a0000000-0000-4000-8000-000000000003'
const TASK_TIMED = 'b0000000-0000-4000-8000-000000000001'
const TASK_DATE_ONLY = 'b0000000-0000-4000-8000-000000000002'
const TASK_DONE = 'b0000000-0000-4000-8000-000000000003'
const TASK_ARCHIVED = 'b0000000-0000-4000-8000-000000000004'
const TASK_IMPORTED = 'b0000000-0000-4000-8000-000000000005'
const NOTE_RICH = 'c0000000-0000-4000-8000-000000000001'
const NOTE_LOOSE = 'c0000000-0000-4000-8000-000000000002'
const NOTE_ARCHIVED = 'c0000000-0000-4000-8000-000000000003'
const NOTE_EDITED = 'c0000000-0000-4000-8000-000000000004'
const NOTE_OTHER = 'c0000000-0000-4000-8000-000000000005'

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

async function registerOwner(db, id, label) {
  await db.query('insert into auth.users (id) values ($1)', [id])
  await db.query(`insert into private.identities (user_id, kind, label) values ($1, 'owner', $2)`, [id, label])
}

function paragraph(text) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** A database with a fictional history: old dates, edits, archives, every task and note shape. */
async function sourceDatabase() {
  const db = await database()
  await registerOwner(db, OWNER, 'Fictional owner')
  await registerOwner(db, OTHER_OWNER, 'Fictional second owner')

  await db.query(
    `insert into public.contexts (id, owner_id, name, slug, show_on_tv, created_at, updated_at, archived_at) values
       ($1, $4, 'Fictional Work', 'work', true, '2026-09-01T08:00:00.123456Z', '2026-09-02T09:30:00Z', null),
       ($2, $4, 'Fictional Home', 'home', false, '2026-09-03T10:00:00Z', '2026-09-20T11:00:00Z', '2026-09-20T11:00:00Z'),
       ($3, $5, 'Other Account', 'other', false, '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z', null)`,
    [WORK, HOME, OTHER_CONTEXT, OWNER, OTHER_OWNER],
  )

  await db.query(
    `insert into public.tasks
       (id, owner_id, context_id, title, notes, status, priority, due_at, due_on, hide_from_tv, origin, source, external_id, created_at, archived_at)
     values
       ($1, $6, $7, 'Call the fictional supplier', E'Line one\nLine two', 'open', 'high', '2026-10-20T14:30:00Z', null, false, 'owner', null, null, '2026-09-05T08:00:00Z', null),
       ($2, $6, $7, 'Café plans 🚀 — “quotes”', null, 'open', 'low', null, '2026-10-24', true, 'owner', null, null, '2026-09-06T08:00:00Z', null),
       ($3, $6, $8, 'Finished fictional errand', null, 'done', 'medium', null, null, false, 'owner', null, null, '2026-09-07T08:00:00Z', null),
       ($4, $6, $8, 'Archived fictional task', null, 'open', 'medium', null, null, false, 'owner', null, null, '2026-09-08T08:00:00Z', '2026-09-30T12:00:00Z'),
       ($5, $6, $7, 'Imported fictional item', null, 'open', 'medium', null, null, false, 'integration', 'fiction-feed', 'item-42', '2026-09-09T08:00:00Z', null)`,
    [TASK_TIMED, TASK_DATE_ONLY, TASK_DONE, TASK_ARCHIVED, TASK_IMPORTED, OWNER, WORK, HOME],
  )

  const notes = [
    [NOTE_RICH, WORK, 'Fictional plan', richNote.doc, true, null],
    [NOTE_LOOSE, null, 'Uncategorised fictional note', paragraph('Nothing real here.'), false, null],
    [NOTE_ARCHIVED, HOME, 'Archived fictional note', paragraph('Old.'), false, '2026-09-25T09:00:00Z'],
    [NOTE_EDITED, WORK, 'First title', paragraph('Draft.'), false, null],
  ]
  for (const [id, context, title, content, pinned, archivedAt] of notes) {
    await db.query(
      `insert into public.notes (id, owner_id, context_id, title, content, pinned, archived_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [id, OWNER, context, title, JSON.stringify(content), pinned, archivedAt],
    )
  }
  await db.query(
    `insert into public.notes (id, owner_id, title, content) values ($1, $2, 'Other account note', $3::jsonb)`,
    [NOTE_OTHER, OTHER_OWNER, JSON.stringify(paragraph('Belongs to someone else.'))],
  )

  // Two real edits through the database rules: revision 1 becomes 3.
  await db.query(`update public.notes set title = 'Second title' where id = $1`, [NOTE_EDITED])
  await db.query(`update public.notes set title = 'Edited fictional note' where id = $1`, [NOTE_EDITED])

  // Then move the history into the past, as a long-used database would have it.
  await db.exec(`
    set session_replication_role = replica;
    update public.tasks set completed_at = '2026-10-10T16:45:12.345678Z' where id = '${TASK_DONE}';
    update public.tasks set updated_at = created_at + interval '1 day';
    update public.notes set created_at = '2026-09-10T07:00:00.5Z', updated_at = '2026-10-01T18:20:00.654321Z';
    set session_replication_role = origin;
  `)
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

  it("holds exactly the owner's contexts, tasks and notes, and nothing from sign-in", async () => {
    expect(backup.counts).toEqual({ contexts: 2, tasks: 5, notes: 4 })
    for (const table of TABLE_NAMES) {
      for (const row of backup.data[table]) expect(Object.keys(row).sort()).toEqual(Object.keys(TABLES[table].columns).sort())
    }
    const text = JSON.stringify(backup)
    expect(text).not.toContain(OWNER)
    expect(text).not.toContain(OTHER_OWNER)
    expect(text).not.toContain('Other account')
    expect(text).not.toMatch(/owner_id|password|email|secret|factor|token|session/i)

    const { otherRecords } = await readBackupData(source, { ownerId: OWNER })
    expect(otherRecords).toBe(2)
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
    await expect(restoreBackup(target, backup, OWNER)).rejects.toThrow(/already holds contexts, tasks or notes/)
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
    expect(() => readBackup(text.replace('"formatVersion": 1', '"formatVersion": 2'))).toThrow(/format version 2/)
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
