import { ids, secretNote } from './fixtures.mjs'

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
  if (fields !== 'context,due_at,priority,title') return `unexpected fields: ${fields}`
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
]
