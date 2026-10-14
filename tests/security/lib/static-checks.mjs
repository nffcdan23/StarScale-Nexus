// Rules every migration must follow, checked by reading the SQL text. They
// catch a forgotten lock before anything runs, on any machine.

function stripComments(sql) {
  return sql.replace(/--.*$/gm, '').toLowerCase()
}

function names(sql, pattern) {
  return [...sql.matchAll(pattern)].map((match) => match[1])
}

export function runStaticChecks(migrations) {
  const sql = migrations.map((migration) => stripComments(migration.sql)).join('\n')
  const tables = names(sql, /create table\s+([\w.]+)/g)
  // Every function, with or without inputs, created or replaced.
  const functions = [...sql.matchAll(/create (?:or replace )?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)as \$\$/g)].map(
    ([, name, , header]) => ({ name, header }),
  )
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const missing = (items, test) => items.filter((item) => !test(item))
  const result = (id, title, problems) => ({
    id,
    title,
    status: problems.length === 0 ? 'passed' : 'failed',
    detail: problems.length === 0 ? '' : `missing for: ${problems.join(', ')}`,
  })

  return [
    result(
      'STATIC-01',
      'Every table switches on row-level security',
      missing(tables, (table) => sql.includes(`alter table ${table} enable row level security`)),
    ),
    result(
      'STATIC-02',
      'Every table starts by removing all access',
      missing(tables, (table) =>
        sql.includes(`revoke all on table ${table} from public, anon, authenticated`),
      ),
    ),
    result(
      'STATIC-03',
      'Every function has its default permission removed',
      missing(
        functions.map((fn) => fn.name),
        (name) =>
          new RegExp(`revoke all on function ${escape(name)}\\([^)]*\\) from public, anon, authenticated`).test(sql),
      ),
    ),
    result(
      'STATIC-04',
      'Every function fixes its search path, so it cannot be tricked into using planted objects',
      missing(functions, (fn) => fn.header.includes("set search_path = ''")).map((fn) => fn.name),
    ),
    {
      id: 'STATIC-05',
      title: 'Nothing is granted to visitors who are not signed in',
      ...(/\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/.test(sql)
        ? { status: 'failed', detail: 'a grant to anon or public was found' }
        : { status: 'passed', detail: '' }),
    },
    {
      id: 'STATIC-06',
      title: 'Nobody is granted permission to delete rows',
      ...(/\bgrant\b[^;]*\b(delete|all)\b[^;]*\bon table\b/.test(sql)
        ? { status: 'failed', detail: 'a delete or all-access grant on a table was found' }
        : { status: 'passed', detail: '' }),
    },
  ]
}
