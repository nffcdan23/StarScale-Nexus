// Proof that the checks can fail. Each entry removes one essential protection
// from a copy of the migrations (never from the real files). The access
// checks are then re-run and at least one of them must fail; if they all
// still pass, the checks are not actually guarding that protection.

const remove = (snippet) => (sql) => sql.replace(snippet, '')

export const mutations = [
  {
    id: 'SELFTEST-01',
    title: 'Row-level security switched off on tasks',
    apply: remove('alter table public.tasks enable row level security;'),
  },
  {
    id: 'SELFTEST-02',
    title: 'Second-factor rule removed from tasks',
    apply: (sql) => sql.replace(/create policy tasks_owner_with_second_factor[\s\S]*?;\n/, ''),
  },
  {
    id: 'SELFTEST-03',
    title: 'Default access left in place on tasks',
    apply: remove('revoke all on table public.tasks from public, anon, authenticated;'),
  },
  {
    id: 'SELFTEST-04',
    title: 'Default permission left in place on the TV summary',
    apply: remove('revoke all on function public.tv_summary() from public, anon, authenticated;'),
  },
  {
    id: 'SELFTEST-05',
    title: 'TV summary no longer leaves out tasks hidden from the TV',
    apply: remove('and not t.hide_from_tv'),
  },
  {
    id: 'SELFTEST-06',
    title: 'TV summary no longer leaves out contexts hidden from the TV',
    apply: remove('and c.show_on_tv'),
  },
  {
    id: 'SELFTEST-07',
    title: 'TV summary no longer checks who is calling',
    apply: (sql) =>
      sql.replace(
        "if (select private.is_owner()) and (select auth.jwt() ->> 'aal') = 'aal2' then",
        'if true then',
      ),
  },
  {
    id: 'SELFTEST-08',
    title: 'A TV sign-in is treated as an owner',
    apply: remove("and i.kind = 'owner'"),
  },
  {
    id: 'SELFTEST-09',
    title: 'Rule allowing only one kind of deadline removed',
    apply: (sql) => sql.replace(/alter table public\.tasks\s+add constraint tasks_one_kind_of_deadline[^;]*;/, ''),
  },
]

/** Applies one mutation to a copy of the migrations. Throws if it changed nothing. */
export function mutate(migrations, mutation) {
  let changed = false
  const mutated = migrations.map((migration) => {
    const sql = mutation.apply(migration.sql)
    if (sql !== migration.sql) changed = true
    return { ...migration, sql }
  })
  if (!changed) {
    throw new Error(
      `${mutation.id} no longer matches the migrations. Update it in tests/security/lib/mutations.mjs.`,
    )
  }
  return mutated
}
