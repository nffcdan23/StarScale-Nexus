// Made-up Nexus records with a realistic history (old dates, edits, archives,
// every task and note shape), for the backup tests and the cloud restore
// drill. Nothing here is real data.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readBackupData } from '../../scripts/backup/database.mjs'
import { createBackup } from '../../scripts/backup/format.mjs'
import { loadMigrations } from '../security/lib/migrations.mjs'
import { projectRoot } from '../security/lib/paths.mjs'
import { createMockDatabase } from '../security/mock/pglite-database.mjs'

export const richNote = JSON.parse(await readFile(join(projectRoot, 'tests', 'security', 'lib', 'rich-note.json'), 'utf8'))

export const fictional = {
  owner: '11111111-1111-4111-8111-111111111111',
  otherOwner: '22222222-2222-4222-8222-222222222222',
  work: 'a0000000-0000-4000-8000-000000000001',
  home: 'a0000000-0000-4000-8000-000000000002',
  otherContext: 'a0000000-0000-4000-8000-000000000003',
  taskTimed: 'b0000000-0000-4000-8000-000000000001',
  taskDateOnly: 'b0000000-0000-4000-8000-000000000002',
  taskDone: 'b0000000-0000-4000-8000-000000000003',
  taskArchived: 'b0000000-0000-4000-8000-000000000004',
  taskImported: 'b0000000-0000-4000-8000-000000000005',
  noteRich: 'c0000000-0000-4000-8000-000000000001',
  noteLoose: 'c0000000-0000-4000-8000-000000000002',
  noteArchived: 'c0000000-0000-4000-8000-000000000003',
  noteEdited: 'c0000000-0000-4000-8000-000000000004',
  noteOther: 'c0000000-0000-4000-8000-000000000005',
}

export async function registerOwner(db, id, label) {
  await db.query('insert into auth.users (id) values ($1)', [id])
  await db.query(`insert into private.identities (user_id, kind, label) values ($1, 'owner', $2)`, [id, label])
}

export function paragraph(text) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Fills a database built from the migrations (PGlite only) with the made-up history. */
export async function addFictionalHistory(db) {
  const f = fictional
  await registerOwner(db, f.owner, 'Fictional owner')
  await registerOwner(db, f.otherOwner, 'Fictional second owner')

  await db.query(
    `insert into public.contexts (id, owner_id, name, slug, show_on_tv, created_at, updated_at, archived_at) values
       ($1, $4, 'Fictional Work', 'work', true, '2026-09-01T08:00:00.123456Z', '2026-09-02T09:30:00Z', null),
       ($2, $4, 'Fictional Home', 'home', false, '2026-09-03T10:00:00Z', '2026-09-20T11:00:00Z', '2026-09-20T11:00:00Z'),
       ($3, $5, 'Other Account', 'other', false, '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z', null)`,
    [f.work, f.home, f.otherContext, f.owner, f.otherOwner],
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
    [f.taskTimed, f.taskDateOnly, f.taskDone, f.taskArchived, f.taskImported, f.owner, f.work, f.home],
  )

  const notes = [
    [f.noteRich, f.work, 'Fictional plan', richNote.doc, true, null],
    [f.noteLoose, null, 'Uncategorised fictional note', paragraph('Nothing real here.'), false, null],
    [f.noteArchived, f.home, 'Archived fictional note', paragraph('Old.'), false, '2026-09-25T09:00:00Z'],
    [f.noteEdited, f.work, 'First title', paragraph('Draft.'), false, null],
  ]
  for (const [id, context, title, content, pinned, archivedAt] of notes) {
    await db.query(
      `insert into public.notes (id, owner_id, context_id, title, content, pinned, archived_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [id, f.owner, context, title, JSON.stringify(content), pinned, archivedAt],
    )
  }
  await db.query(
    `insert into public.notes (id, owner_id, title, content) values ($1, $2, 'Other account note', $3::jsonb)`,
    [f.noteOther, f.otherOwner, JSON.stringify(paragraph('Belongs to someone else.'))],
  )

  // Two real edits through the database rules: revision 1 becomes 3.
  await db.query(`update public.notes set title = 'Second title' where id = $1`, [f.noteEdited])
  await db.query(`update public.notes set title = 'Edited fictional note' where id = $1`, [f.noteEdited])

  // Then move the history into the past, as a long-used database would have it.
  await db.exec(`
    set session_replication_role = replica;
    update public.tasks set completed_at = '2026-10-10T16:45:12.345678Z' where id = '${f.taskDone}';
    update public.tasks set updated_at = created_at + interval '1 day';
    update public.notes set created_at = '2026-09-10T07:00:00.5Z', updated_at = '2026-10-01T18:20:00.654321Z';
    set session_replication_role = origin;
  `)
}

/** A backup of the fictional owner's records, made in a throwaway in-memory database. */
export async function makeFictionalBackup() {
  const db = await createMockDatabase(await loadMigrations())
  try {
    await addFictionalHistory(db)
    const { data, migrations } = await readBackupData(db, { ownerId: fictional.owner })
    return createBackup({ data, source: { environment: 'fictional', migrations } })
  } finally {
    await db.close()
  }
}
