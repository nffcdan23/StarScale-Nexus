// NEXUS-ADMIN-ONLY: a description of everything the Nexus migrations create,
// read from a database's own catalogue, so two databases can be compared.
// Never imported by the app.
//
// Used to prove the cloud database has exactly the same tables, columns,
// constraints, indexes, access rules (row-level security and policies),
// functions, triggers and permissions for visitors (anon) and signed-in
// users (authenticated) as the local database that passed the real checks.
// Reads only.

import { canonicalJson } from '../backup/format.mjs'

const SCHEMAS = `('public', 'private')`
const notFromExtension = (catalog, column) =>
  `not exists (select 1 from pg_depend d where d.classid = '${catalog}'::regclass and d.objid = ${column} and d.deptype = 'e')`

const QUERIES = {
  tables: `
    select n.nspname || '.' || c.relname as key,
           jsonb_build_object('kind', c.relkind::text, 'rowSecurity', c.relrowsecurity, 'forced', c.relforcerowsecurity) as value
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ${SCHEMAS} and c.relkind in ('r', 'p', 'v', 'm') and ${notFromExtension('pg_class', 'c.oid')}`,
  columns: `
    select n.nspname || '.' || c.relname || '.' || a.attname as key,
           jsonb_build_object('type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
                              'default', pg_get_expr(d.adbin, d.adrelid), 'generated', a.attgenerated::text) as value
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname in ${SCHEMAS} and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped`,
  constraints: `
    select n.nspname || '.' || c.relname || '.' || k.conname as key, to_jsonb(pg_get_constraintdef(k.oid)) as value
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ${SCHEMAS}`,
  indexes: `
    select schemaname || '.' || indexname as key, to_jsonb(indexdef) as value
    from pg_indexes where schemaname in ${SCHEMAS}`,
  policies: `
    select schemaname || '.' || tablename || '.' || policyname as key,
           jsonb_build_object('permissive', permissive, 'roles', (select jsonb_agg(r order by r) from unnest(roles) r),
                              'command', cmd, 'using', qual, 'check', with_check) as value
    from pg_policies where schemaname in ${SCHEMAS}`,
  functions: `
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as key,
           jsonb_build_object('returns', pg_get_function_result(p.oid), 'securityDefiner', p.prosecdef,
                              'volatility', p.provolatile::text, 'settings', to_jsonb(p.proconfig), 'body', md5(p.prosrc)) as value
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ${SCHEMAS} and ${notFromExtension('pg_proc', 'p.oid')}`,
  triggers: `
    select n.nspname || '.' || c.relname || '.' || t.tgname as key, to_jsonb(pg_get_triggerdef(t.oid)) as value
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ${SCHEMAS} and not t.tgisinternal`,
  // What visitors (anon), signed-in users (authenticated) and everyone
  // (PUBLIC) may do. Empty permission lists mean the PostgreSQL defaults,
  // which are filled in so that "never granted" and "default" compare equal.
  permissions: `
    with grants as (
      select 'schema ' || n.nspname as object, a.grantee, a.privilege_type
      from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
      where n.nspname in ${SCHEMAS}
      union all
      select 'table ' || n.nspname || '.' || c.relname, a.grantee, a.privilege_type
      from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where n.nspname in ${SCHEMAS} and c.relkind in ('r', 'p', 'v', 'm', 'S')
      union all
      select 'column ' || n.nspname || '.' || c.relname || '.' || t.attname, a.grantee, a.privilege_type
      from pg_attribute t join pg_class c on c.oid = t.attrelid join pg_namespace n on n.oid = c.relnamespace, aclexplode(t.attacl) a
      where n.nspname in ${SCHEMAS} and t.attacl is not null and t.attnum > 0 and not t.attisdropped
      union all
      select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', a.grantee, a.privilege_type
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname in ${SCHEMAS} and ${notFromExtension('pg_proc', 'p.oid')}
    )
    select object || ': ' || case when grantee = 0 then 'PUBLIC' else pg_get_userbyid(grantee) end || ' ' || privilege_type as key,
           'true'::jsonb as value
    from grants
    where grantee = 0 or pg_get_userbyid(grantee) in ('anon', 'authenticated')`,
}

export const STRUCTURE_AREAS = Object.keys(QUERIES)

/** { area: { object: description } } for everything in the public and private schemas. Reads only. */
export async function readStructure(db) {
  const structure = {}
  for (const [area, sql] of Object.entries(QUERIES)) {
    const { rows } = await db.query(sql)
    structure[area] = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }
  return structure
}

/** Every difference between the expected structure and the one found, in words. Empty when they match. */
export function compareStructures(expected, actual, { expectedName = 'local', actualName = 'cloud' } = {}) {
  const differences = []
  for (const area of STRUCTURE_AREAS) {
    const want = expected[area] ?? {}
    const have = actual[area] ?? {}
    for (const key of Object.keys(want).sort()) {
      if (!(key in have)) differences.push(`${area}: ${key} is in ${expectedName} but missing in ${actualName}`)
      else if (canonicalJson(want[key]) !== canonicalJson(have[key])) {
        differences.push(`${area}: ${key} differs (${expectedName} ${canonicalJson(want[key])}, ${actualName} ${canonicalJson(have[key])})`)
      }
    }
    for (const key of Object.keys(have).sort()) {
      if (!(key in want)) differences.push(`${area}: ${key} is in ${actualName} but not in ${expectedName}`)
    }
  }
  return differences
}

/** How many objects of each kind, for example "8 tables, 64 columns, ...". */
export function describeStructure(structure) {
  return STRUCTURE_AREAS.map((area) => `${Object.keys(structure[area]).length} ${area}`).join(', ')
}
