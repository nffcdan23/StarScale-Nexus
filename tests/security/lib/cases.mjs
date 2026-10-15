import { ids, noteDoc, richNote, secretNote, secretNoteBody } from './fixtures.mjs'

// The single list of who may do what. Each check is one SQL statement run as
// one identity, with the outcome it must have. The same list is used against
// the PGlite imitation and, later, against real Supabase.

// ---- Expected outcomes ----------------------------------------------------

const refused = (pattern) => ({ errorCode: '42501', errorMatch: pattern })
const tableRefused = (table) => refused(new RegExp(`permission denied for table ${table}`))
const privateRefused = refused(/permission denied for schema private/)
const blockedByRules = refused(/row-level security/)
const seesRows = (count) => ({ rows: count })
const changesRows = (count) => ({ affected: count })
const passes = (verify) => ({ verify })

/** The TV summary must list only the one visible task, with titles and dates and nothing more. */
function summaryIsRedacted(rows) {
  const summary = rows[0]?.summary
  if (!summary || !Array.isArray(summary.tasks)) return 'no summary was returned'
  const titles = summary.tasks.map((task) => task.title)
  if (JSON.stringify(titles) !== JSON.stringify(['Visible task'])) {
    return `expected only "Visible task", got ${JSON.stringify(titles)}`
  }
  const fields = Object.keys(summary.tasks[0]).sort().join(',')
  if (fields !== 'context,due_at,due_on,priority,title') return `unexpected fields: ${fields}`
  if (JSON.stringify(summary).includes(secretNote)) return 'the summary leaked a task note'
  return null
}

// ---- Statements reused by several identities ------------------------------

const readTasks = 'select id from public.tasks'
const readContexts = 'select id from public.contexts'
const addTask = `insert into public.tasks (context_id, title) values ('${ids.contextVisible}', 'New task')`
const addContext = "insert into public.contexts (name, slug) values ('New area', 'new-area')"
const renameTasks = "update public.tasks set title = 'Changed'"
const deleteTasks = 'delete from public.tasks'
const callSummary = 'select public.tv_summary() as summary'
const readIdentities = 'select user_id from private.identities'
const readNotes = 'select id from public.notes'
const addNote = "insert into public.notes (title) values ('New note')"
const renameNotes = "update public.notes set title = 'Changed'"
const searchNotes = (text) => `select * from public.search_notes('${text}')`

// ---- The checks -----------------------------------------------------------

export const cases = [
  // Not signed in: nothing at all.
  { id: 'ANON-01', identity: 'anonymous', title: 'Cannot read tasks', sql: readTasks, expect: tableRefused('tasks') },
  { id: 'ANON-02', identity: 'anonymous', title: 'Cannot read contexts', sql: readContexts, expect: tableRefused('contexts') },
  { id: 'ANON-03', identity: 'anonymous', title: 'Cannot add a task', sql: addTask, expect: tableRefused('tasks') },
  { id: 'ANON-04', identity: 'anonymous', title: 'Cannot change tasks', sql: renameTasks, expect: tableRefused('tasks') },
  { id: 'ANON-05', identity: 'anonymous', title: 'Cannot delete tasks', sql: deleteTasks, expect: tableRefused('tasks') },
  {
    id: 'ANON-06',
    identity: 'anonymous',
    title: 'Cannot run the TV summary',
    sql: callSummary,
    expect: refused(/permission denied for function tv_summary/),
  },
  { id: 'ANON-07', identity: 'anonymous', title: 'Cannot read the identity register', sql: readIdentities, expect: privateRefused },
  { id: 'ANON-08', identity: 'anonymous', title: 'Cannot run private helper functions', sql: 'select private.is_owner()', expect: privateRefused },

  // TV sign-in: the summary and nothing else.
  { id: 'TV-01', identity: 'tv', title: 'Sees no tasks directly', sql: readTasks, expect: seesRows(0) },
  { id: 'TV-02', identity: 'tv', title: 'Sees no contexts directly', sql: readContexts, expect: seesRows(0) },
  { id: 'TV-03', identity: 'tv', title: 'Cannot add a task', sql: addTask, expect: blockedByRules },
  { id: 'TV-04', identity: 'tv', title: 'Cannot add a context', sql: addContext, expect: blockedByRules },
  { id: 'TV-05', identity: 'tv', title: 'Cannot change any task', sql: renameTasks, expect: changesRows(0) },
  { id: 'TV-06', identity: 'tv', title: 'Cannot delete tasks', sql: deleteTasks, expect: tableRefused('tasks') },
  { id: 'TV-07', identity: 'tv', title: 'Cannot read the identity register', sql: readIdentities, expect: privateRefused },
  {
    id: 'TV-08',
    identity: 'tv',
    title: 'TV summary shows only visible tasks, titles and dates only',
    sql: callSummary,
    expect: passes(summaryIsRedacted),
  },

  // Owner who has not entered an authenticator code: locked out, reading included.
  { id: 'NOCODE-01', identity: 'ownerNoCode', title: 'Sees no tasks', sql: readTasks, expect: seesRows(0) },
  { id: 'NOCODE-02', identity: 'ownerNoCode', title: 'Sees no contexts', sql: readContexts, expect: seesRows(0) },
  { id: 'NOCODE-03', identity: 'ownerNoCode', title: 'Cannot add a task', sql: addTask, expect: blockedByRules },
  { id: 'NOCODE-04', identity: 'ownerNoCode', title: 'Cannot change any task', sql: renameTasks, expect: changesRows(0) },
  {
    id: 'NOCODE-05',
    identity: 'ownerNoCode',
    title: 'Cannot run the TV summary',
    sql: callSummary,
    expect: refused(/caller is not allowed/),
  },

  // Owner with an authenticator code: full use of their own records only.
  { id: 'OWNER-01', identity: 'ownerWithCode', title: 'Sees their own five tasks and nobody else\'s', sql: readTasks, expect: seesRows(5) },
  { id: 'OWNER-02', identity: 'ownerWithCode', title: 'Sees their own two contexts', sql: readContexts, expect: seesRows(2) },
  {
    id: 'OWNER-03',
    identity: 'ownerWithCode',
    title: 'Can add a task; the database records the owner and origin itself',
    sql: `${addTask} returning owner_id, origin`,
    expect: passes((rows) =>
      rows[0]?.owner_id === ids.owner && rows[0]?.origin === 'owner'
        ? null
        : `unexpected owner or origin: ${JSON.stringify(rows[0])}`,
    ),
  },
  {
    id: 'OWNER-04',
    identity: 'ownerWithCode',
    title: 'Can change their own task',
    sql: `update public.tasks set title = 'Changed' where id = '${ids.taskVisible}'`,
    expect: changesRows(1),
  },
  {
    id: 'OWNER-05',
    identity: 'ownerWithCode',
    title: 'Marking a task done records when it was completed',
    sql: `update public.tasks set status = 'done' where id = '${ids.taskVisible}' returning completed_at`,
    expect: passes((rows) => (rows[0]?.completed_at ? null : 'completed_at was not set')),
  },
  { id: 'OWNER-06', identity: 'ownerWithCode', title: 'Cannot delete tasks (archive only)', sql: deleteTasks, expect: tableRefused('tasks') },
  {
    id: 'OWNER-07',
    identity: 'ownerWithCode',
    title: 'Cannot choose a task\'s owner',
    sql: `insert into public.tasks (owner_id, context_id, title) values ('${ids.otherOwner}', '${ids.contextOther}', 'Planted')`,
    expect: tableRefused('tasks'),
  },
  {
    id: 'OWNER-08',
    identity: 'ownerWithCode',
    title: 'Cannot choose a task\'s origin',
    sql: `insert into public.tasks (context_id, title, origin) values ('${ids.contextVisible}', 'Fake', 'assistant')`,
    expect: tableRefused('tasks'),
  },
  {
    id: 'OWNER-09',
    identity: 'ownerWithCode',
    title: 'Cannot hand a task to another owner',
    sql: `update public.tasks set owner_id = '${ids.otherOwner}' where id = '${ids.taskVisible}'`,
    expect: tableRefused('tasks'),
  },
  {
    id: 'OWNER-10',
    identity: 'ownerWithCode',
    title: 'Cannot file a task under another owner\'s context',
    sql: `insert into public.tasks (context_id, title) values ('${ids.contextOther}', 'Misfiled')`,
    expect: { errorCode: '23503' },
  },
  {
    id: 'OWNER-11',
    identity: 'ownerWithCode',
    title: 'Cannot change another owner\'s task',
    sql: `update public.tasks set title = 'Changed' where id = '${ids.taskOther}'`,
    expect: changesRows(0),
  },
  {
    id: 'OWNER-12',
    identity: 'ownerWithCode',
    title: 'A blank task title is rejected',
    sql: `insert into public.tasks (context_id, title) values ('${ids.contextVisible}', '   ')`,
    expect: { errorCode: '23514' },
  },
  { id: 'OWNER-13', identity: 'ownerWithCode', title: 'Cannot read the identity register', sql: readIdentities, expect: privateRefused },
  {
    id: 'OWNER-14',
    identity: 'ownerWithCode',
    title: 'Can run the summary, with the same redaction as the TV',
    sql: callSummary,
    expect: passes(summaryIsRedacted),
  },

  // Operations the Tasks page relies on (Phase 2c-2a).
  {
    id: 'OWNER-15',
    identity: 'ownerWithCode',
    title: 'Reopening a task clears its completion time',
    sql: `update public.tasks set status = 'open' where id = '${ids.taskDone}' returning completed_at`,
    expect: passes((rows) => (rows.length === 1 && rows[0].completed_at === null ? null : `got ${JSON.stringify(rows)}`)),
  },
  {
    id: 'OWNER-16',
    identity: 'ownerWithCode',
    title: 'Can archive their own task',
    sql: `update public.tasks set archived_at = now() where id = '${ids.taskVisible}'`,
    expect: changesRows(1),
  },
  {
    id: 'OWNER-17',
    identity: 'ownerWithCode',
    title: 'Can restore their own archived task',
    sql: `update public.tasks set archived_at = null where id = '${ids.taskArchived}'`,
    expect: changesRows(1),
  },
  {
    id: 'OWNER-18',
    identity: 'ownerWithCode',
    title: 'Can rename a context and change its TV setting',
    sql: `update public.contexts set name = 'Renamed', show_on_tv = false where id = '${ids.contextVisible}'`,
    expect: changesRows(1),
  },
  {
    id: 'OWNER-19',
    identity: 'ownerWithCode',
    title: 'Cannot hand a context to another owner',
    sql: `update public.contexts set owner_id = '${ids.otherOwner}' where id = '${ids.contextVisible}'`,
    expect: tableRefused('contexts'),
  },
  {
    id: 'OWNER-20',
    identity: 'ownerWithCode',
    title: 'Cannot change another owner\'s context',
    sql: `update public.contexts set show_on_tv = false where id = '${ids.contextOther}'`,
    expect: changesRows(0),
  },
  {
    id: 'TV-09',
    identity: 'tv',
    title: 'Cannot change any context or its TV setting',
    sql: 'update public.contexts set show_on_tv = true',
    expect: changesRows(0),
  },
  {
    id: 'NOCODE-06',
    identity: 'ownerNoCode',
    title: 'Cannot change any context or its TV setting',
    sql: 'update public.contexts set show_on_tv = true',
    expect: changesRows(0),
  },

  // Deadlines (migration 20261015090000_task_due_on, Phase 2c-2b).
  {
    id: 'OWNER-21',
    identity: 'ownerWithCode',
    title: 'Can give a task a date-only deadline',
    sql: `update public.tasks set due_on = '2026-10-20' where id = '${ids.taskVisible}' returning due_on, due_at`,
    expect: passes((rows) =>
      rows.length === 1 && String(rows[0].due_on).length > 0 && rows[0].due_at === null ? null : `got ${JSON.stringify(rows)}`,
    ),
  },
  {
    id: 'OWNER-22',
    identity: 'ownerWithCode',
    title: 'A task cannot have both a date-only and a timed deadline',
    sql: `update public.tasks set due_on = '2026-10-20', due_at = now() where id = '${ids.taskVisible}'`,
    expect: { errorCode: '23514' },
  },
  {
    id: 'OWNER-23',
    identity: 'ownerWithCode',
    title: 'Can add a task with a date-only deadline',
    sql: `insert into public.tasks (context_id, title, due_on) values ('${ids.contextVisible}', 'Dated', '2026-10-20') returning due_on`,
    expect: changesRows(1),
  },
  {
    id: 'OWNER-24',
    identity: 'ownerWithCode',
    title: 'Can switch a deadline from a date to a time in one change',
    sql: `update public.tasks set due_on = null, due_at = '2026-10-20T09:00:00Z' where id = '${ids.taskVisible}'`,
    expect: changesRows(1),
  },
  {
    id: 'TV-10',
    identity: 'tv',
    title: 'Cannot set any deadline',
    sql: "update public.tasks set due_on = '2026-10-20'",
    expect: changesRows(0),
  },
  {
    id: 'NOCODE-07',
    identity: 'ownerNoCode',
    title: 'Cannot set any deadline',
    sql: "update public.tasks set due_on = '2026-10-20'",
    expect: changesRows(0),
  },
  {
    id: 'ANON-09',
    identity: 'anonymous',
    title: 'Cannot set any deadline',
    sql: "update public.tasks set due_on = '2026-10-20'",
    expect: tableRefused('tasks'),
  },

  // The TV summary's filtering and order (migration 20261016090000_tv_summary_due_on, Phase 2c-3a).
  {
    id: 'TV-11',
    identity: 'tv',
    title: 'TV summary includes a date-only deadline',
    setup: `update public.tasks set due_on = '2026-10-20' where id = '${ids.taskVisible}'`,
    sql: callSummary,
    expect: passes((rows) => {
      const task = rows[0]?.summary?.tasks?.[0]
      return task?.due_on === '2026-10-20' && task.due_at === null
        ? null
        : `expected due_on 2026-10-20 and no due_at, got ${JSON.stringify(task)}`
    }),
  },
  {
    id: 'TV-12',
    identity: 'tv',
    title: 'TV summary leaves out tasks in an archived context, even one shown on TV',
    setup: `
      insert into public.contexts (id, owner_id, name, slug, show_on_tv, archived_at) values
        ('${ids.contextArchived}', '${ids.owner}', 'Old project', 'old-project', true, now());
      insert into public.tasks (owner_id, context_id, title) values
        ('${ids.owner}', '${ids.contextArchived}', 'Archived context task');`,
    sql: callSummary,
    expect: passes(summaryIsRedacted),
  },
  {
    id: 'TV-13',
    identity: 'tv',
    title: 'TV summary lists by deadline day in London time, then priority',
    setup: `
      insert into public.tasks (owner_id, context_id, title, priority, due_on, due_at) values
        ('${ids.owner}', '${ids.contextVisible}', 'Day two, high', 'high', null, '2026-10-21T09:00:00Z'),
        ('${ids.owner}', '${ids.contextVisible}', 'Just after midnight in London', 'high', null, '2026-10-20T23:30:00Z'),
        ('${ids.owner}', '${ids.contextVisible}', 'Day one, all day, low', 'low', '2026-10-20', null),
        ('${ids.owner}', '${ids.contextVisible}', 'Day one, 9 AM, high', 'high', null, '2026-10-20T08:00:00Z');`,
    sql: callSummary,
    expect: passes((rows) => {
      const titles = rows[0]?.summary?.tasks?.map((task) => task.title)
      const expected = [
        'Day one, 9 AM, high',
        'Day one, all day, low',
        'Just after midnight in London',
        'Day two, high',
        'Visible task',
      ]
      return JSON.stringify(titles) === JSON.stringify(expected)
        ? null
        : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(titles)}`
    }),
  },

  // A TV sign-in that enrols its own authenticator must gain nothing.
  { id: 'TVCODE-01', identity: 'tvWithCode', title: 'Still sees no tasks directly', sql: readTasks, expect: seesRows(0) },
  { id: 'TVCODE-02', identity: 'tvWithCode', title: 'Still cannot add a task', sql: addTask, expect: blockedByRules },
  { id: 'TVCODE-03', identity: 'tvWithCode', title: 'Still cannot add a context', sql: addContext, expect: blockedByRules },
  { id: 'TVCODE-04', identity: 'tvWithCode', title: 'Still gets only the redacted summary', sql: callSummary, expect: passes(summaryIsRedacted) },

  // A sign-in Nexus does not know about, even with a second factor.
  { id: 'STRANGER-01', identity: 'strangerWithCode', title: 'Sees no tasks', sql: readTasks, expect: seesRows(0) },
  { id: 'STRANGER-02', identity: 'strangerWithCode', title: 'Cannot add a context', sql: addContext, expect: blockedByRules },
  {
    id: 'STRANGER-03',
    identity: 'strangerWithCode',
    title: 'Cannot run the TV summary',
    sql: callSummary,
    expect: refused(/caller is not allowed/),
  },

  // Notes (migration 20261017090000_notes, Phase 3a). Owner-only with an
  // authenticator code, exactly like tasks; the TV gets nothing.
  { id: 'ANON-10', identity: 'anonymous', title: 'Cannot read notes', sql: readNotes, expect: tableRefused('notes') },
  {
    id: 'ANON-11',
    identity: 'anonymous',
    title: 'Cannot search notes',
    sql: searchNotes('investor'),
    expect: refused(/permission denied for function search_notes/),
  },
  { id: 'TV-14', identity: 'tv', title: 'Sees no notes', sql: readNotes, expect: seesRows(0) },
  { id: 'TV-15', identity: 'tv', title: 'Cannot add a note', sql: addNote, expect: blockedByRules },
  { id: 'TV-16', identity: 'tv', title: 'Cannot change any note', sql: renameNotes, expect: changesRows(0) },
  { id: 'TV-17', identity: 'tv', title: 'Finds nothing when searching notes', sql: searchNotes('investor'), expect: seesRows(0) },
  {
    id: 'TV-18',
    identity: 'tv',
    title: 'TV summary contains no note titles or text',
    sql: callSummary,
    expect: passes((rows) => {
      const text = JSON.stringify(rows[0]?.summary ?? null)
      return ['Board meeting', 'Shopping list', secretNoteBody, 'Buy milk'].some((leak) => text.includes(leak))
        ? 'the TV summary contains note content'
        : null
    }),
  },
  { id: 'TVCODE-05', identity: 'tvWithCode', title: 'Still sees no notes', sql: readNotes, expect: seesRows(0) },
  { id: 'NOCODE-08', identity: 'ownerNoCode', title: 'Sees no notes', sql: readNotes, expect: seesRows(0) },
  { id: 'NOCODE-09', identity: 'ownerNoCode', title: 'Cannot add a note', sql: addNote, expect: blockedByRules },
  { id: 'NOCODE-10', identity: 'ownerNoCode', title: 'Finds nothing when searching notes', sql: searchNotes('investor'), expect: seesRows(0) },
  { id: 'STRANGER-04', identity: 'strangerWithCode', title: 'Sees no notes', sql: readNotes, expect: seesRows(0) },

  { id: 'NOTE-01', identity: 'ownerWithCode', title: 'Sees their own three notes and nobody else\'s', sql: readNotes, expect: seesRows(3) },
  {
    id: 'NOTE-02',
    identity: 'ownerWithCode',
    title: 'Can add a note with no context; the database sets the owner, revision and searchable text',
    sql: `insert into public.notes (title, content) values ('Ideas', '${noteDoc('First idea')}')
          returning owner_id, context_id, revision, content_text`,
    expect: passes((rows) => {
      const row = rows[0]
      return row?.owner_id === ids.owner && row.context_id === null && row.revision === 1 && row.content_text === 'First idea'
        ? null
        : `unexpected new note: ${JSON.stringify(row)}`
    }),
  },
  {
    id: 'NOTE-03',
    identity: 'ownerWithCode',
    title: 'Can file a note under their own context, and take it out again',
    sql: `update public.notes set context_id = case when context_id is null then '${ids.contextVisible}'::uuid end
          where id in ('${ids.noteFiled}', '${ids.noteUncategorised}')`,
    expect: changesRows(2),
  },
  {
    id: 'NOTE-04',
    identity: 'ownerWithCode',
    title: 'Cannot file a note under another owner\'s context',
    sql: `update public.notes set context_id = '${ids.contextOther}' where id = '${ids.noteUncategorised}'`,
    expect: { errorCode: '23503' },
  },
  {
    id: 'NOTE-05',
    identity: 'ownerWithCode',
    title: 'Cannot choose a note\'s owner',
    sql: `insert into public.notes (owner_id, title) values ('${ids.otherOwner}', 'Planted')`,
    expect: tableRefused('notes'),
  },
  {
    id: 'NOTE-06',
    identity: 'ownerWithCode',
    title: 'Cannot change a note\'s owner',
    sql: `update public.notes set owner_id = '${ids.otherOwner}' where id = '${ids.noteFiled}'`,
    expect: tableRefused('notes'),
  },
  {
    id: 'NOTE-07',
    identity: 'ownerWithCode',
    title: 'Cannot set a revision number',
    sql: `update public.notes set revision = 99 where id = '${ids.noteFiled}'`,
    expect: tableRefused('notes'),
  },
  {
    id: 'NOTE-08',
    identity: 'ownerWithCode',
    title: 'Cannot set the creation or edit time',
    sql: `update public.notes set created_at = '2020-01-01', updated_at = '2020-01-01' where id = '${ids.noteFiled}'`,
    expect: tableRefused('notes'),
  },
  {
    id: 'NOTE-09',
    identity: 'ownerWithCode',
    title: 'Cannot write the searchable text directly',
    sql: `update public.notes set content_text = 'Something else' where id = '${ids.noteFiled}'`,
    expect: tableRefused('notes'),
  },
  {
    id: 'NOTE-10',
    identity: 'ownerWithCode',
    title: 'The searchable text always follows the document: headings, lists and line breaks',
    sql: `update public.notes set content = '${JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'One ' }, { type: 'text', marks: [{ type: 'bold' }], text: 'two' }, { type: 'hardBreak' }, { type: 'text', text: 'three' }],
        },
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call the bank' }] }] }],
        },
      ],
    })}' where id = '${ids.noteFiled}' returning content_text`,
    expect: passes((rows) =>
      rows[0]?.content_text === 'Plan\nOne two\nthree\nCall the bank' ? null : `got ${JSON.stringify(rows[0]?.content_text)}`,
    ),
  },
  {
    id: 'NOTE-11',
    identity: 'ownerWithCode',
    title: 'Editing the title or text raises the revision',
    sql: `update public.notes set title = 'Board meeting notes' where id = '${ids.noteFiled}' returning revision`,
    expect: passes((rows) => (rows[0]?.revision === 2 ? null : `revision is ${rows[0]?.revision}`)),
  },
  {
    id: 'NOTE-12',
    identity: 'ownerWithCode',
    title: 'Pinning or archiving leaves the revision alone',
    sql: `update public.notes set pinned = true, archived_at = now() where id = '${ids.noteFiled}' returning revision`,
    expect: passes((rows) => (rows[0]?.revision === 1 ? null : `revision is ${rows[0]?.revision}`)),
  },
  {
    id: 'NOTE-13',
    identity: 'ownerWithCode',
    title: 'A save based on an older revision changes nothing',
    sql: `update public.notes set title = 'Overwrite' where id = '${ids.noteFiled}' and revision = 0`,
    expect: changesRows(0),
  },
  { id: 'NOTE-14', identity: 'ownerWithCode', title: 'Cannot delete notes', sql: 'delete from public.notes', expect: tableRefused('notes') },
  {
    id: 'NOTE-15',
    identity: 'ownerWithCode',
    title: 'Content that is not a document is rejected',
    sql: `update public.notes set content = '{"type": "paragraph"}' where id = '${ids.noteFiled}'`,
    expect: { errorCode: '23514' },
  },
  {
    id: 'NOTE-16',
    identity: 'ownerWithCode',
    title: 'A link that is not a web or email address is rejected',
    sql: `update public.notes set content = '${JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }],
    })}' where id = '${ids.noteFiled}'`,
    expect: { errorCode: '23514' },
  },
  {
    id: 'NOTE-17',
    identity: 'ownerWithCode',
    title: 'A title over 200 characters is rejected',
    sql: `update public.notes set title = repeat('x', 201) where id = '${ids.noteFiled}'`,
    expect: { errorCode: '23514' },
  },
  {
    id: 'NOTE-18',
    identity: 'ownerWithCode',
    title: 'Cannot change another owner\'s note',
    sql: `update public.notes set title = 'Changed' where id = '${ids.noteOther}'`,
    expect: changesRows(0),
  },
  {
    id: 'NOTE-19',
    identity: 'ownerWithCode',
    title: 'Search finds their own notes by word or word start, never archived or other owners\' notes',
    sql: searchNotes('invest'),
    expect: passes((rows) => {
      const titles = rows.map((row) => row.title)
      return JSON.stringify(titles) === JSON.stringify(['Board meeting']) ? null : `got ${JSON.stringify(titles)}`
    }),
  },
  {
    id: 'NOTE-20',
    identity: 'ownerWithCode',
    title: 'Search can include archived notes and keep to one context',
    sql: `select title from public.search_notes('investor', true, '${ids.contextVisible}')`,
    expect: passes((rows) => {
      const titles = rows.map((row) => row.title).sort()
      return JSON.stringify(titles) === JSON.stringify(['Board meeting', 'Old idea']) ? null : `got ${JSON.stringify(titles)}`
    }),
  },
  {
    id: 'NOTE-21',
    identity: 'ownerWithCode',
    title: 'Search snippets mark matches with characters that are not HTML',
    sql: searchNotes('timeline'),
    expect: passes((rows) => {
      const snippet = rows[0]?.snippet ?? ''
      return snippet.includes('timeline') && !snippet.includes('<') ? null : `got ${JSON.stringify(snippet)}`
    }),
  },
  {
    id: 'NOTE-22',
    identity: 'ownerWithCode',
    title: 'An overlong search is refused',
    sql: `select * from public.search_notes(repeat('a', 201))`,
    expect: { errorCode: '22023' },
  },
  {
    id: 'NOTE-23',
    identity: 'ownerWithCode',
    title: 'Every editor format (quotes, dividers, code included) is accepted and its text made searchable',
    sql: `update public.notes set content = '${JSON.stringify(richNote.doc).replaceAll("'", "''")}'
          where id = '${ids.noteFiled}' returning content_text`,
    expect: passes((rows) =>
      rows[0]?.content_text === richNote.text ? null : `got ${JSON.stringify(rows[0]?.content_text)}`,
    ),
  },
]

/**
 * Checks that cannot be imitated, because they exercise Supabase's own
 * sign-in service and Data API. They are implemented in real/api-checks.mjs
 * and run only against a real local Supabase stack.
 */
export const realOnlyCases = [
  { id: 'REAL-01', title: 'The migrations apply cleanly to a real Supabase database' },
  { id: 'REAL-02', title: 'A visitor with only the public key reads nothing through the Data API' },
  { id: 'REAL-03', title: 'A visitor with only the public key cannot run the TV summary' },
  { id: 'REAL-04', title: 'Password sign-in alone gives the owner no data' },
  { id: 'REAL-05', title: 'After a real authenticator code, the owner can read and add tasks' },
  { id: 'REAL-06', title: 'A real TV sign-in gets the redacted summary and no table access' },
  { id: 'REAL-07', title: 'A real TV sign-in cannot write through the Data API' },
  { id: 'REAL-08', title: 'New sign-ups are refused' },
  { id: 'REAL-09', title: 'After a real authenticator code, the owner can add and search a note but not forge its searchable text' },
  { id: 'REAL-10', title: 'A real TV sign-in cannot read, search or add notes, and a visitor cannot search them' },
]
