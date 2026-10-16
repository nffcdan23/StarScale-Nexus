// Cloud tools (Phase 3c-4b-2), tested with fictional settings, fake
// connections and throwaway in-memory databases only. Nothing here reaches
// a real database or the internet. Runs on any computer: npm run test:cloud.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreDrill } from '../../scripts/cloud/drill.mjs'
import {
  checkKeys,
  describeConnectionError,
  destructiveStatements,
  isEmpty,
  judgeAuthSettings,
  migrationPlan,
  readProjectState,
} from '../../scripts/cloud/project.mjs'
import { askHidden, askSecretKey, confirmProject } from '../../scripts/cloud/prompt.mjs'
import { cloudSettings, loadCloudSettings, pushCommand, redact, shortRef } from '../../scripts/cloud/settings.mjs'
import { compareStructures, readStructure } from '../../scripts/cloud/structure.mjs'
import { refusedCommand } from '../../tools/windows/supabase-cli.mjs'
import { addFictionalHistory, makeFictionalBackup, paragraph } from '../backup/fictional-data.mjs'
import { cloudOnlyCases } from '../security/lib/cases.mjs'
import { loadMigrations } from '../security/lib/migrations.mjs'
import { projectRoot } from '../security/lib/paths.mjs'
import { recordResults } from '../security/lib/real-checks.mjs'
import { buildReport } from '../security/lib/report.mjs'
import { createMockDatabase } from '../security/mock/pglite-database.mjs'

// Fictional project: none of these values belong to a real project.
const REF = 'abcdefghijklmnopqrst'
const CA = '-----BEGIN CERTIFICATE-----\nFICTIONAL\n-----END CERTIFICATE-----\n'
const ENV = {
  NEXUS_CLOUD_PROJECT_REF: REF,
  NEXUS_CLOUD_PUBLISHABLE_KEY: 'sb_publishable_FictionalKey_123',
  NEXUS_CLOUD_DB_HOST: 'aws-0-eu-west-2.pooler.supabase.com',
}
const settings = cloudSettings(ENV, { caText: CA, caPath: 'C:\\Nexus\\supabase-ca.crt' })

const migrations = await loadMigrations()
const open = []
afterEach(async () => {
  while (open.length > 0) await open.pop().close()
})
async function database(list = migrations) {
  const db = await createMockDatabase(list)
  open.push(db)
  return db
}

describe('cloud settings', () => {
  it('derive everything from the project id, so only one project can be reached', () => {
    expect(settings.apiUrl).toBe(`https://${REF}.supabase.co`)
    expect(settings.db).toEqual({ host: 'aws-0-eu-west-2.pooler.supabase.com', port: 5432, user: `postgres.${REF}`, database: 'postgres' })
    expect(shortRef(REF)).toBe('abcd…qrst')
  })

  it('refuse anything that is not exactly a project id, a publishable key and a pooler host', () => {
    const attempt = (change, caText = CA) => () => cloudSettings({ ...ENV, ...change }, { caText })
    expect(attempt({ NEXUS_CLOUD_PROJECT_REF: '' })).toThrow(/missing: NEXUS_CLOUD_PROJECT_REF/)
    expect(attempt({ NEXUS_CLOUD_PROJECT_REF: 'abc' })).toThrow(/20-character project id/)
    expect(attempt({ NEXUS_CLOUD_PROJECT_REF: `https://${REF}.supabase.co` })).toThrow(/20-character project id/)
    expect(attempt({ NEXUS_CLOUD_PUBLISHABLE_KEY: 'sb_secret_Fictional' })).toThrow(/SECRET key.*delete that key/)
    expect(attempt({ NEXUS_CLOUD_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.fictional' })).toThrow(/old-style/)
    expect(attempt({ NEXUS_CLOUD_PUBLISHABLE_KEY: 'fictional' })).toThrow(/starts sb_publishable_/)
    expect(attempt({ NEXUS_CLOUD_DB_HOST: `postgresql://postgres.${REF}:x@aws-0-eu-west-2.pooler.supabase.com:5432/postgres` })).toThrow(
      /session pooler host only/,
    )
    expect(attempt({ NEXUS_CLOUD_DB_HOST: `db.${REF}.supabase.co` })).toThrow(/session pooler host only/)
    expect(attempt({ NEXUS_CLOUD_DB_HOST: '127.0.0.1' })).toThrow(/session pooler host only/)
    expect(attempt({}, '')).toThrow(/supabase-ca.crt is missing/)
    expect(attempt({}, 'not a certificate')).toThrow(/not a certificate/)
  })

  it('are read from the project folder without touching the environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexus-cloud-test-'))
    try {
      expect(() => loadCloudSettings(dir)).toThrow(/\.env\.cloud\.local is missing/)
      await writeFile(join(dir, '.env.cloud.local'), Object.entries(ENV).map(([key, value]) => `${key}=${value}`).join('\n'))
      await writeFile(join(dir, 'supabase-ca.crt'), CA)
      expect(loadCloudSettings(dir).db.user).toBe(`postgres.${REF}`)
      expect(process.env.NEXUS_CLOUD_PROJECT_REF).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('are never secret: the files that hold them stay out of Git', async () => {
    const gitignore = (await readFile(join(projectRoot, '.gitignore'), 'utf8')).split(/\r?\n/)
    expect(gitignore).toEqual(expect.arrayContaining(['.env.*', '!.env.*.example', 'supabase-ca.crt']))
    const example = await readFile(join(projectRoot, '.env.cloud.example'), 'utf8')
    for (const line of example.split(/\r?\n/).filter((entry) => /^NEXUS_/.test(entry))) expect(line).toMatch(/=$/)
    expect(example).not.toMatch(/sb_secret_[A-Za-z0-9]|PASSWORD=/)
  })

  it('build the migration command without the password on the command line', () => {
    const preview = pushCommand(settings, 'fictional-password-123', { dryRun: true })
    expect(preview.args).toEqual(['db', 'push', '--db-url', `postgresql://postgres.${REF}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`, '--dry-run'])
    expect(preview.args.join(' ')).not.toContain('fictional-password-123')
    expect(preview.env).toEqual({ PGPASSWORD: 'fictional-password-123', PGSSLMODE: 'verify-full', PGSSLROOTCERT: 'C:\\Nexus\\supabase-ca.crt' })
    const apply = pushCommand(settings, 'fictional-password-123', { dryRun: false })
    expect(apply.args).not.toContain('--dry-run')
    expect(apply.args.join(' ')).not.toMatch(/include-seed|include-all|linked|reset/)
  })

  it('hide secrets in any message', () => {
    expect(redact('failed for p@ss word!x and p%40ss%20word!x', ['p@ss word!x'])).toBe('failed for [hidden] and [hidden]')
    expect(redact('key sb_secret_FictionalValue rejected', ['sb_secret_FictionalValue'])).toBe('key [hidden] rejected')
    expect(redact('nothing to hide', [null, ''])).toBe('nothing to hide')
  })
})

/** A fake terminal: whatever the test types arrives as keystrokes. */
function terminal() {
  const input = new PassThrough()
  input.isTTY = true
  input.setRawMode = vi.fn()
  const output = new PassThrough()
  let shown = ''
  output.on('data', (chunk) => (shown += chunk))
  return { io: { input, output }, input, shown: () => shown }
}

describe('typing secrets and confirmations', () => {
  it('reads a hidden secret, with backspace, and never shows it', async () => {
    const { io, input, shown } = terminal()
    const answer = askHidden('Database password', io)
    input.write('fictionalpass')
    input.write('\u007f')
    input.write('S\r')
    await expect(answer).resolves.toBe('fictionalpasS')
    expect(shown()).toContain('Database password (typing is hidden)')
    expect(shown()).not.toContain('fictional')
    expect(input.setRawMode).toHaveBeenLastCalledWith(false)
  })

  it('stops on Ctrl+C, and refuses anything that is not a terminal', async () => {
    const { io, input } = terminal()
    const answer = askHidden('Database password', io)
    input.write('abc\u0003')
    await expect(answer).rejects.toThrow(/Stopped/)
    await expect(askHidden('Database password', { input: new PassThrough(), output: new PassThrough() })).rejects.toThrow(
      /terminal window/,
    )
  })

  it('accepts only a new-style secret key', async () => {
    for (const [typed, outcome] of [
      ['eyJhbGciOiJIUzI1NiJ9.fictional', /old-style service_role/],
      ['sb_publishable_Fictional', /not a secret key/],
    ]) {
      const { io, input } = terminal()
      const answer = askSecretKey(io)
      input.write(`${typed}\r`)
      await expect(answer).rejects.toThrow(outcome)
    }
    const { io, input } = terminal()
    const answer = askSecretKey(io)
    input.write('sb_secret_FictionalValue\r')
    await expect(answer).resolves.toBe('sb_secret_FictionalValue')
  })

  it('goes ahead only when the exact project id is typed', async () => {
    const typed = async (text) => {
      const input = new PassThrough()
      const answer = confirmProject(REF, { input, output: new PassThrough() })
      input.end(text)
      return answer
    }
    expect(await typed(`${REF}\n`)).toBe(true)
    expect(await typed(`  ${REF}  \n`)).toBe(true)
    expect(await typed('\n')).toBe(false)
    expect(await typed(`${REF.toUpperCase()}\n`)).toBe(false)
    expect(await typed('yes\n')).toBe(false)
  })
})

describe('checking the project', () => {
  const reply = (status, body) => Promise.resolve({ status, json: () => Promise.resolve(body) })

  it('confirms both keys with this project only, sending them as Supabase expects', async () => {
    const fetchImpl = vi.fn((url) =>
      reply(200, url.includes('/admin/') ? { users: [] } : { disable_signup: true, external: { email: true } }),
    )
    const authSettings = await checkKeys(settings, { secretKey: 'sb_secret_FictionalValue', fetchImpl })
    expect(authSettings.disable_signup).toBe(true)
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `https://${REF}.supabase.co/auth/v1/settings`,
      `https://${REF}.supabase.co/auth/v1/admin/users?page=1&per_page=1`,
    ])
    expect(fetchImpl.mock.calls[0][1].headers.apikey).toBe(ENV.NEXUS_CLOUD_PUBLISHABLE_KEY)
    expect(fetchImpl.mock.calls[1][1].headers.apikey).toBe('sb_secret_FictionalValue')
  })

  it('stops when a key belongs to another project or the project cannot be reached', async () => {
    await expect(checkKeys(settings, { fetchImpl: () => reply(401, { message: 'Invalid API key' }) })).rejects.toThrow(
      /publishable key was not accepted/,
    )
    const secretRefused = (url) => reply(url.includes('/admin/') ? 401 : 200, {})
    await expect(checkKeys(settings, { secretKey: 'sb_secret_FictionalValue', fetchImpl: secretRefused })).rejects.toThrow(
      /secret key was not accepted/,
    )
    const offline = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))
    await expect(checkKeys(settings, { fetchImpl: offline })).rejects.toThrow(/Could not reach https:\/\/abcdefghijklmnopqrst\.supabase\.co \(ENOTFOUND\)/)
  })

  it('compares the sign-in settings with supabase/config.toml', () => {
    const external = { email: true, phone: false, anonymous_users: false, google: false }
    expect(judgeAuthSettings({ disable_signup: true, external })).toEqual([])
    expect(judgeAuthSettings({ disable_signup: false, external })).toEqual([expect.stringMatching(/Sign-ups are ON/)])
    expect(judgeAuthSettings({ disable_signup: true, external: { ...external, email: false } })).toEqual([
      expect.stringMatching(/Email sign-in is OFF/),
    ])
    expect(judgeAuthSettings({ disable_signup: true, external: { ...external, anonymous_users: true, google: true, phone: true } })).toEqual([
      'phone sign-in is ON: turn it off',
      'Anonymous sign-ins are ON: turn them off',
      'google sign-in is ON: turn it off',
    ])
  })

  it('explains connection problems without ever showing the password', () => {
    const problem = (error) => describeConnectionError(error, settings, ['fictional-password-123']).message
    expect(problem({ code: 'SELF_SIGNED_CERT_IN_CHAIN' })).toMatch(/could not be verified.*before the password was sent/)
    expect(problem({ code: '28P01' })).toMatch(/password was not accepted/)
    expect(problem({ code: 'XX000', message: 'Tenant or user not found' })).toMatch(/does not know this project id/)
    expect(problem({ message: 'odd failure mentioning fictional-password-123' })).not.toContain('fictional-password-123')
  })

  it('reads what a database holds, before and after the migrations', async () => {
    const fresh = await readProjectState(await database([]))
    expect(fresh).toMatchObject({ applied: [], hasNexusTables: false })
    expect(isEmpty(fresh)).toBe(true)

    const migrated = await database()
    await migrated.exec(`
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key);
      insert into supabase_migrations.schema_migrations values ('20261013120000'), ('20261015090000');`)
    const empty = await readProjectState(migrated)
    expect(empty.applied).toEqual(['20261013120000', '20261015090000'])
    expect(empty.hasNexusTables).toBe(true)
    expect(isEmpty(empty)).toBe(true)

    await addFictionalHistory(migrated)
    const full = await readProjectState(migrated)
    expect(full.counts).toEqual({ accounts: 2, identities: 2, contexts: 3, tasks: 5, notes: 5 })
    expect(isEmpty(full)).toBe(false)
  })

  it('applies migrations only in order, and never over an unknown history', () => {
    const repo = ['1', '2', '3', '4']
    expect(migrationPlan([], repo)).toEqual({ problem: null, pending: ['1', '2', '3', '4'] })
    expect(migrationPlan(['1', '2'], repo)).toEqual({ problem: null, pending: ['3', '4'] })
    expect(migrationPlan(repo, repo)).toEqual({ problem: null, pending: [] })
    expect(migrationPlan(['1', '9'], repo).problem).toMatch(/does not have: 9/)
    expect(migrationPlan(['1', '3'], repo).problem).toMatch(/different order or with gaps/)
  })

  it('never applies a migration that could remove or change stored data', () => {
    for (const migration of migrations) expect(destructiveStatements(migration.sql), migration.name).toEqual([])
    expect(destructiveStatements('drop table public.notes;')).toEqual(['drops a table, view or schema'])
    expect(destructiveStatements('alter table public.tasks drop column title;')).toEqual(['drops a column'])
    expect(destructiveStatements('truncate public.tasks;')).toEqual(['empties a table'])
    expect(destructiveStatements('delete from public.tasks;')).toEqual(['deletes rows'])
    expect(destructiveStatements('update public.tasks set title = null;')).toEqual(['changes existing rows'])
    expect(destructiveStatements('-- drop table public.notes\n/* truncate x */ create table t (id int);')).toEqual([])
    expect(destructiveStatements('create function f() returns void language sql as $$ delete from t $$;')).toEqual([])
  })
})

describe('structure comparison', () => {
  it('finds no difference between two databases built from the same migrations', async () => {
    const expected = await readStructure(await database())
    expect(compareStructures(expected, await readStructure(await database()))).toEqual([])
    expect(Object.keys(expected.policies)).toContain('public.notes.notes_owner_with_second_factor')
  })

  it('names every weakened protection', async () => {
    const expected = await readStructure(await database())
    const weakened = await database()
    await weakened.exec(`
      drop policy notes_owner_with_second_factor on public.notes;
      grant select on public.notes to anon;
      alter table public.tasks disable row level security;
      alter table public.contexts alter column show_on_tv set default true;
      create or replace function private.is_owner() returns boolean language sql stable security definer set search_path = '' as $$ select true $$;`)
    const differences = compareStructures(expected, await readStructure(weakened))
    expect(differences).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^policies: public\.notes\.notes_owner_with_second_factor is in local but missing in cloud/),
        expect.stringMatching(/^permissions: table public\.notes: anon SELECT is in cloud but not in local/),
        expect.stringMatching(/^tables: public\.tasks differs/),
        expect.stringMatching(/^columns: public\.contexts\.show_on_tv differs/),
        expect.stringMatching(/^functions: private\.is_owner\(\) differs/),
      ]),
    )
  })
})

describe('restore drill (fictional data)', () => {
  async function counts(db) {
    return (await readProjectState(db)).counts
  }

  it('restores identically, checks who can see it, and leaves the database exactly as it was', async () => {
    const db = await database()
    const backup = await makeFictionalBackup()
    const result = await restoreDrill(db, backup)
    expect(result.fingerprint).toBe(backup.dataFingerprint)
    expect(await counts(db)).toEqual({ accounts: 0, identities: 0, contexts: 0, tasks: 0, notes: 0 })
  })

  it('fails, and still undoes everything, when the access rules are wrong', async () => {
    const db = await database()
    await db.exec('drop policy notes_owner_with_second_factor on public.notes')
    await expect(restoreDrill(db, await makeFictionalBackup())).rejects.toThrow(/without an authenticator code could see/)
    expect(await counts(db)).toEqual({ accounts: 0, identities: 0, contexts: 0, tasks: 0, notes: 0 })
  })

  it('refuses a database that already holds records, and leaves them alone', async () => {
    const db = await database()
    await addFictionalHistory(db)
    const before = await counts(db)
    await expect(restoreDrill(db, await makeFictionalBackup())).rejects.toThrow(/already holds/)
    expect(await counts(db)).toEqual(before)
  })

  it('fails, and undoes everything, when a record breaks a database rule', async () => {
    const db = await database()
    const backup = await makeFictionalBackup()
    const { createBackup } = await import('../../scripts/backup/format.mjs')
    const data = structuredClone(backup.data)
    data.notes[0].content = paragraph('x')
    data.notes[0].content.content[0].content[0].marks = [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]
    await expect(restoreDrill(db, createBackup({ data, source: backup.source }))).rejects.toThrow(/refused the restore/)
    expect(await counts(db)).toEqual({ accounts: 0, identities: 0, contexts: 0, tasks: 0, notes: 0 })
  })
})

describe('npm run supabase stays local', () => {
  it('refuses cloud, platform, reset and data-deleting commands', () => {
    for (const args of [
      ['link', '--project-ref', REF],
      ['login'],
      ['projects', 'list'],
      ['config', 'push'],
      ['db', 'push', '--db-url', 'postgresql://example'],
      ['db', 'push', '--linked'],
      ['db', 'dump', '--db-url=postgresql://example'],
      ['migration', 'list', '--linked'],
      ['db', 'reset'],
      ['db', 'reset', '--local'],
      ['stop', '--no-backup'],
    ]) {
      expect(refusedCommand(args), args.join(' ')).not.toBeNull()
    }
  })

  it('still allows the local commands Nexus uses', () => {
    for (const args of [
      ['start'],
      ['stop'],
      ['status'],
      ['migration', 'up', '--local'],
      ['migration', 'list', '--local'],
      ['gen', 'types', 'typescript', '--local'],
      ['db', 'dump', '--local', '--data-only'],
    ]) {
      expect(refusedCommand(args), args.join(' ')).toBeNull()
    }
  })
})

describe('cloud results stay separate', () => {
  const base = {
    fingerprint: 'f1',
    applyResult: { status: 'passed' },
    staticResults: [],
    mockResults: [{ id: 'ACC-01', identity: 'Owner', title: 'An access check', status: 'passed', detail: '' }],
    selfTests: [],
    realOnlyCases: [{ id: 'REAL-01', title: 'A real check' }],
    cloudOnlyCases,
  }
  const passedAll = (ids, extra = {}) => ({
    fingerprint: 'f1',
    ranOn: '2026-10-17',
    system: 'win32',
    ...extra,
    results: ids.map((id) => ({ id, status: 'passed', detail: '' })),
  })
  const allIds = ['ACC-01', 'REAL-01', ...cloudOnlyCases.map((testCase) => testCase.id)]

  it('a verified local stack says nothing about the cloud project', () => {
    const report = buildReport({ ...base, real: passedAll(['ACC-01', 'REAL-01']), cloud: null })
    expect(report).toContain('**Security status: VERIFIED on real Supabase')
    expect(report).toContain('**Cloud project status: NOT VERIFIED.** No real personal data may be stored in the cloud project.')
    expect(report).toContain('Cloud checks have never been run.')
    expect(report).toContain(`| Cloud | 0 | 0 | ${allIds.length} | 0 | ${allIds.length} |`)
  })

  it('the cloud project is verified only when every check passed for the current migrations', () => {
    const verified = buildReport({ ...base, real: null, cloud: passedAll(allIds, { project: 'abcd…qrst', postgres: '17.6' }) })
    expect(verified).toContain('**Cloud project status: VERIFIED for this version of the migrations (project abcd…qrst).**')
    expect(verified).toContain('**Security status: NOT VERIFIED on real Supabase.**')
    expect(verified).toContain('on project abcd…qrst, PostgreSQL 17.6')

    const stale = buildReport({ ...base, real: null, cloud: { ...passedAll(allIds), fingerprint: 'old' } })
    expect(stale).toContain('**Cloud project status: NOT VERIFIED.**')

    const oneFailed = passedAll(allIds)
    oneFailed.results[0].status = 'failed'
    expect(buildReport({ ...base, real: null, cloud: oneFailed })).toContain('**Cloud project status: NOT VERIFIED.**')
  })

  it('a check that never ran is recorded as not executed, never as an older result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexus-cloud-results-'))
    try {
      const path = join(dir, 'results.json')
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const counts = await recordResults(path, {
        label: 'the cloud project',
        fingerprint: 'f1',
        expectedIds: ['CLOUD-01', 'CLOUD-02'],
        results: [{ id: 'CLOUD-01', status: 'passed', detail: '' }],
        aborted: 'fictional stop',
        extra: { project: 'abcd…qrst' },
      })
      log.mockRestore()
      expect(counts).toEqual({ passed: 1, failed: 0, notExecuted: 1, total: 2 })
      const saved = JSON.parse(await readFile(path, 'utf8'))
      expect(saved).toMatchObject({ project: 'abcd…qrst', aborted: 'fictional stop' })
      expect(saved.results[1]).toEqual({ id: 'CLOUD-02', status: 'not-executed', detail: 'run stopped: fictional stop' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the Mac never reaches the cloud project', () => {
  it('every cloud command refuses before reading settings, on any computer but Windows', async () => {
    for (const file of ['scripts/cloud/status.mjs', 'scripts/cloud/migrate.mjs', 'tests/security/cloud/run-cloud.mjs']) {
      const source = await readFile(join(projectRoot, file), 'utf8')
      const guard = source.indexOf("requireWindows('")
      expect(guard, file).toBeGreaterThan(-1)
      expect(guard, file).toBeLessThan(source.indexOf('loadCloudSettings(projectRoot)'))
    }
  })

  it.skipIf(process.platform === 'win32')('the cloud security run stops on this computer before doing anything', async () => {
    const { runCloud } = await import('../security/cloud/run-cloud.mjs')
    await expect(runCloud({ suite: {}, fingerprint: 'f1', expectedIds: [], migrationVersions: [] })).rejects.toThrow(
      /only on the Windows PC/,
    )
  })

  it('secrets are never read from files or the environment', async () => {
    for (const file of ['settings.mjs', 'prompt.mjs', 'project.mjs', 'structure.mjs', 'drill.mjs']) {
      const source = await readFile(join(projectRoot, 'scripts', 'cloud', file), 'utf8')
      expect(source, file).not.toContain('process.env')
    }
  })
})

describe('cloud sign-ins (Phase 3c-4b-3)', () => {
  const owner = { userId: 'o0000000-0000-4000-8000-000000000001', kind: 'owner', email: 'owner@example.test' }

  it('are refused until the recorded cloud checks all passed, for this project and these migrations', async () => {
    const { verificationProblem } = await import('../../scripts/cloud/accounts.mjs')
    const expectedIds = ['ACC-01', 'CLOUD-01']
    const recorded = {
      project: shortRef(REF),
      fingerprint: 'f1',
      results: expectedIds.map((id) => ({ id, status: 'passed', detail: '' })),
    }
    const check = (results, fingerprint = 'f1') => verificationProblem(results, { fingerprint, projectRef: REF, expectedIds })
    expect(check(recorded)).toBeNull()
    expect(check(null)).toMatch(/have not been recorded/)
    expect(check({ ...recorded, project: 'zzzz…zzzz' })).toMatch(/for project zzzz…zzzz/)
    expect(check(recorded, 'f2')).toMatch(/migrations have changed/)
    expect(check({ ...recorded, results: [recorded.results[0]] })).toMatch(/not every recorded cloud check passed \(CLOUD-01\)/)
    expect(check({ ...recorded, results: [recorded.results[0], { id: 'CLOUD-01', status: 'failed' }] })).toMatch(/CLOUD-01/)
  })

  it('allow exactly one owner, then TVs that show that owner', async () => {
    const { accountPlan } = await import('../../scripts/cloud/accounts.mjs')
    expect(accountPlan('owner', { email: ' Owner@Example.test ', registered: [], accounts: 0 })).toEqual({
      email: 'owner@example.test',
      ownerId: null,
    })
    expect(accountPlan('owner', { email: 'second@example.test', registered: [owner], accounts: 1 }).problem).toMatch(
      /already exists \(owner@example\.test\)/,
    )
    expect(accountPlan('tv', { email: 'tv@example.test', registered: [], accounts: 0 }).problem).toMatch(/create the owner/)
    expect(accountPlan('tv', { email: 'tv@example.test', registered: [owner], accounts: 1 })).toEqual({
      email: 'tv@example.test',
      ownerId: owner.userId,
    })
    expect(accountPlan('tv', { email: 'OWNER@example.test', registered: [owner], accounts: 1 }).problem).toMatch(/already has a Nexus sign-in/)
  })

  it('refuse while stray accounts exist, and refuse a bad address', async () => {
    const { accountPlan } = await import('../../scripts/cloud/accounts.mjs')
    expect(accountPlan('owner', { email: 'owner@example.test', registered: [], accounts: 1 }).problem).toMatch(/not Nexus sign-ins/)
    expect(accountPlan('tv', { email: 'tv@example.test', registered: [owner], accounts: 2 }).problem).toMatch(/not Nexus sign-ins/)
    for (const email of ['', 'owner', 'owner@', 'a b@example.test', undefined]) {
      expect(accountPlan('owner', { email, registered: [], accounts: 0 }).problem, String(email)).toMatch(/valid --email/)
    }
  })
})

describe('changing a cloud sign-in password (fictional accounts, fake Supabase)', () => {
  const owner = { userId: 'o0000000-0000-4000-8000-000000000001', kind: 'owner', email: 'owner@example.test' }
  const tv = { userId: 't0000000-0000-4000-8000-000000000002', kind: 'tv', email: 'tv@example.test' }
  const chosen = 'Fictional-New-Passphrase-42'

  it('takes the command and address only: never a password on the command line', async () => {
    const { parseAccountArguments } = await import('../../scripts/cloud/accounts.mjs')
    expect(parseAccountArguments(['password', '--email', 'owner@example.test'])).toEqual({ command: 'password', email: 'owner@example.test' })
    for (const argv of [
      ['password'],
      ['password', '--email', 'owner@example.test', '--password', chosen],
      ['password', '--password', chosen],
      ['password', '--email', 'owner@example.test', chosen],
    ]) {
      expect(parseAccountArguments(argv).problem, argv.join(' ')).toMatch(/password --email ADDRESS/)
    }
  })

  it('finds only a registered Nexus sign-in', async () => {
    const { findSignIn } = await import('../../scripts/cloud/accounts.mjs')
    expect(findSignIn([owner, tv], ' Owner@Example.test ')).toBe(owner)
    expect(findSignIn([owner, tv], 'tv@example.test')).toBe(tv)
    expect(findSignIn([owner, tv], 'someone@example.test')).toBeNull()
  })

  it('accepts a new password only when it is long enough, not too long and has no stray spaces', async () => {
    const { newPasswordProblem } = await import('../../scripts/cloud/accounts.mjs')
    expect(newPasswordProblem(chosen)).toBeNull()
    expect(newPasswordProblem('short-pass1')).toMatch(/at least 12/)
    expect(newPasswordProblem('é'.repeat(37))).toMatch(/at most 72 bytes/)
    expect(newPasswordProblem('x'.repeat(72))).toBeNull()
    expect(newPasswordProblem(` ${chosen}`)).toMatch(/space/)
    expect(newPasswordProblem(`${chosen} `)).toMatch(/space/)
  })

  it('asks twice, hidden, and never shows it', async () => {
    const { askNewPassword } = await import('../../scripts/cloud/prompt.mjs')
    const { io, input, shown } = terminal()
    const answer = askNewPassword(io)
    input.write(`${chosen}\r`)
    await new Promise((resolve) => setImmediate(resolve))
    input.write(`${chosen}\r`)
    await expect(answer).resolves.toBe(chosen)
    expect(shown()).toContain('New password (typing is hidden)')
    expect(shown()).toContain('Type the new password again (typing is hidden)')
    expect(shown()).not.toContain(chosen)
  })

  it('changes nothing when the two entries differ or the password is unsuitable', async () => {
    const { askNewPassword } = await import('../../scripts/cloud/prompt.mjs')
    const mismatch = terminal()
    const differing = askNewPassword(mismatch.io)
    mismatch.input.write(`${chosen}\r`)
    await new Promise((resolve) => setImmediate(resolve))
    mismatch.input.write(`${chosen}x\r`)
    await expect(differing).rejects.toThrow(/did not match\. Nothing was changed/)

    const short = terminal()
    const tooShort = askNewPassword(short.io)
    short.input.write('short\r')
    await expect(tooShort).rejects.toThrow(/at least 12 characters long\. Nothing was changed/)
    expect(short.shown()).not.toContain('again')
  })

  it("sends only the new password to Supabase's admin API, for that account only", async () => {
    const { setPassword } = await import('../../scripts/cloud/accounts.mjs')
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: owner.userId, email: owner.email }) }))
    await setPassword({ settings, secretKey: 'sb_secret_FictionalValue', userId: owner.userId, password: chosen, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://${REF}.supabase.co/auth/v1/admin/users/${owner.userId}`)
    expect(request.method).toBe('PUT')
    expect(request.headers.apikey).toBe('sb_secret_FictionalValue')
    // Nothing else about the account is touched: no email, role, metadata or factors.
    expect(JSON.parse(request.body)).toEqual({ password: chosen })
  })

  it('reports a refusal plainly, without the password', async () => {
    const { setPassword } = await import('../../scripts/cloud/accounts.mjs')
    const weak = async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error_code: 'weak_password', msg: 'Password is known to be weak', weak_password: { reasons: ['pwned'] } }),
    })
    const attempt = setPassword({ settings, secretKey: 'sb_secret_FictionalValue', userId: owner.userId, password: chosen, fetchImpl: weak })
    await expect(attempt).rejects.toThrow(/status 422, weak_password: Password is known to be weak \(pwned\)\)\. The old password still works/)
    await attempt.catch((error) => expect(error.message).not.toContain(chosen))

    const offline = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))
    await expect(
      setPassword({ settings, secretKey: 'sb_secret_FictionalValue', userId: owner.userId, password: chosen, fetchImpl: offline }),
    ).rejects.toThrow(/ENOTFOUND\)\. The password was not changed/)

    const otherAccount = async () => ({ ok: true, status: 200, json: async () => ({ id: tv.userId }) })
    await expect(
      setPassword({ settings, secretKey: 'sb_secret_FictionalValue', userId: owner.userId, password: chosen, fetchImpl: otherAccount }),
    ).rejects.toThrow(/different account/)
  })

  it('the command never prints the new password', async () => {
    const source = await readFile(join(projectRoot, 'scripts', 'cloud', 'account.mjs'), 'utf8')
    expect(source).not.toMatch(/console\.\w+\([^)]*chosenPassword/)
    expect(source).toMatch(/secrets\.push\(chosenPassword\)/)
    expect(source).not.toMatch(/process\.argv[^\n]*password/i)
  })
})
