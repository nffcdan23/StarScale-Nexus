// The real Nexus data layer (src/data/supabaseData.ts) against a real local
// Supabase stack, signed in the same way the app signs in. Windows PC only.
//
// STATUS: written on the MacBook, never executed there. Expect small
// adjustments on the first run.
//
// Uses the settings in .env.security.local. Creates a temporary owner and TV,
// and removes them (with everything they own) at the end.

import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSupabaseDataServices } from '../../src/data/supabaseData'
import type { DataServices } from '../../src/data/types'
import { authenticatorCode } from '../security/real/api-checks.mjs'

if (existsSync('.env.security.local')) process.loadEnvFile('.env.security.local')

const settings = {
  dbUrl: process.env.NEXUS_TEST_DB_URL ?? '',
  apiUrl: (process.env.NEXUS_TEST_API_URL ?? '').replace(/\/$/, ''),
  publishableKey: process.env.NEXUS_TEST_PUBLISHABLE_KEY ?? '',
  secretKey: process.env.NEXUS_TEST_SECRET_KEY ?? '',
}

function assertLocal() {
  const missing = Object.entries(settings).filter(([, value]) => !value).map(([name]) => name)
  if (missing.length > 0) throw new Error(`Missing settings in .env.security.local: ${missing.join(', ')}`)
  for (const url of [settings.dbUrl, settings.apiUrl]) {
    const host = new URL(url).hostname
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      throw new Error(`Refusing to run: ${host} is not this computer. Integration tests use only a local Supabase stack.`)
    }
  }
}

async function admin(path: string, init: { method: string; body?: unknown }) {
  const response = await fetch(`${settings.apiUrl}/auth/v1/admin${path}`, {
    method: init.method,
    headers: {
      apikey: settings.secretKey,
      Authorization: `Bearer ${settings.secretKey}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Admin request ${path} failed with status ${response.status}`)
  return data
}

interface TestUser {
  id: string
  email: string
  password: string
}

async function createUser(role: 'owner' | 'tv'): Promise<TestUser> {
  const email = `nexus-integration-${role}-${randomUUID()}@example.test`
  const password = randomUUID() + randomUUID()
  const user = await admin('/users', {
    method: 'POST',
    body: { email, password, email_confirm: true, app_metadata: { nexus_role: role } },
  })
  return { id: user.id, email, password }
}

function appClient(): SupabaseClient {
  return createClient(settings.apiUrl, settings.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

let owner: TestUser
let tv: TestUser
let ownerData: DataServices
let tvData: DataServices
let db: { query: (sql: string, params?: unknown[]) => Promise<unknown>; end: () => Promise<void> }

beforeAll(async () => {
  assertLocal()
  const pg = (await import('pg')).default
  const client = new pg.Client({ connectionString: settings.dbUrl })
  await client.connect()
  db = client

  owner = await createUser('owner')
  tv = await createUser('tv')
  await db.query(
    `insert into private.identities (user_id, kind, owner_id) values ($1, 'owner', null), ($2, 'tv', $1)`,
    [owner.id, tv.id],
  )

  // The owner signs in exactly as in the app: password, then authenticator code.
  const ownerClient = appClient()
  const signedIn = await ownerClient.auth.signInWithPassword({ email: owner.email, password: owner.password })
  if (signedIn.error) throw new Error(`Owner sign-in failed: ${signedIn.error.message}`)
  const factor = await ownerClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Nexus integration' })
  if (factor.error) throw new Error(`Authenticator set-up failed: ${factor.error.message}`)
  const verified = await ownerClient.auth.mfa.challengeAndVerify({
    factorId: factor.data.id,
    code: authenticatorCode(factor.data.totp.secret),
  })
  if (verified.error) throw new Error(`Authenticator code refused: ${verified.error.message}`)
  ownerData = createSupabaseDataServices(ownerClient)

  const tvClient = appClient()
  const tvSignIn = await tvClient.auth.signInWithPassword({ email: tv.email, password: tv.password })
  if (tvSignIn.error) throw new Error(`TV sign-in failed: ${tvSignIn.error.message}`)
  tvData = createSupabaseDataServices(tvClient)
})

afterAll(async () => {
  // Removing the sign-ins also removes their contexts and tasks.
  for (const user of [owner, tv]) if (user) await admin(`/users/${user.id}`, { method: 'DELETE' })
  await db?.end()
})

describe('data layer against real Supabase (owner with an authenticator code)', () => {
  it('creates, renames, switches on for the TV, archives and restores a context', async () => {
    const context = await ownerData.contexts.create('Integration')
    expect(context.showOnTv).toBe(false)

    expect((await ownerData.contexts.rename(context.id, 'Renamed')).name).toBe('Renamed')
    expect((await ownerData.contexts.setShowOnTv(context.id, true)).showOnTv).toBe(true)
    expect((await ownerData.contexts.setArchived(context.id, true)).archivedAt).not.toBeNull()
    expect((await ownerData.contexts.list()).some((entry) => entry.id === context.id)).toBe(false)
    expect((await ownerData.contexts.setArchived(context.id, false)).archivedAt).toBeNull()
  })

  it('gives a second context with the same name its own short name', async () => {
    const first = await ownerData.contexts.create('Twin')
    const second = await ownerData.contexts.create('Twin')
    expect(second.id).not.toBe(first.id)
  })

  it('adds a task, completes it and reopens it, with the database keeping the completion time', async () => {
    const context = await ownerData.contexts.create('Tasks')
    const task = await ownerData.tasks.create({ contextId: context.id, title: 'Integration task' })
    expect(task.status).toBe('open')
    expect(task.priority).toBe('medium')
    expect((await ownerData.tasks.list('open')).map((entry) => entry.id)).toContain(task.id)

    const done = await ownerData.tasks.setDone(task.id, true)
    expect(done.completedAt).not.toBeNull()
    expect((await ownerData.tasks.list('done')).map((entry) => entry.id)).toContain(task.id)

    const reopened = await ownerData.tasks.setDone(task.id, false)
    expect(reopened.completedAt).toBeNull()
  })

  it('edits a task\'s title, notes, priority, context and TV setting', async () => {
    const first = await ownerData.contexts.create('Edit from')
    const second = await ownerData.contexts.create('Edit to')
    const task = await ownerData.tasks.create({ contextId: first.id, title: 'Before' })

    const edited = await ownerData.tasks.update(task.id, {
      title: 'After',
      notes: 'Line one\nLine two',
      priority: 'high',
      contextId: second.id,
      hideFromTv: true,
    })
    expect(edited).toMatchObject({ title: 'After', notes: 'Line one\nLine two', priority: 'high', contextId: second.id, hideFromTv: true })
  })

  it('stores a date-only deadline and a timed deadline, and switches between them in one step', async () => {
    const context = await ownerData.contexts.create('Deadlines')
    const task = await ownerData.tasks.create({ contextId: context.id, title: 'Deadline task' })
    expect(task.deadline).toBeNull()

    const byDate = await ownerData.tasks.update(task.id, { deadline: { kind: 'date', date: '2030-03-15' } })
    expect(byDate.deadline).toEqual({ kind: 'date', date: '2030-03-15' })

    const byTime = await ownerData.tasks.update(task.id, { deadline: { kind: 'time', at: '2030-03-15T09:30:00.000Z' } })
    expect(byTime.deadline?.kind).toBe('time')
    expect(byTime.deadline?.kind === 'time' && Date.parse(byTime.deadline.at)).toBe(Date.parse('2030-03-15T09:30:00.000Z'))

    const cleared = await ownerData.tasks.update(task.id, { deadline: null })
    expect(cleared.deadline).toBeNull()
  })

  it('lists tasks completed since a moment, for Mission Control\'s weekly counts', async () => {
    const context = await ownerData.contexts.create('Completed since')
    const before = new Date(Date.now() - 60_000)
    const kept = await ownerData.tasks.create({ contextId: context.id, title: 'Completed and kept' })
    await ownerData.tasks.setDone(kept.id, true)
    const archived = await ownerData.tasks.create({ contextId: context.id, title: 'Completed then archived' })
    await ownerData.tasks.setDone(archived.id, true)
    await ownerData.tasks.setArchived(archived.id, true)
    const open = await ownerData.tasks.create({ contextId: context.id, title: 'Still open' })

    const ids = (await ownerData.tasks.completedSince(before)).map((task) => task.id)
    expect(ids).toContain(kept.id)
    expect(ids).not.toContain(archived.id)
    expect(ids).not.toContain(open.id)
    expect((await ownerData.tasks.completedSince(new Date(Date.now() + 60 * 60_000))).map((task) => task.id)).not.toContain(kept.id)
  })

  it('archives a task out of the open list and restores it', async () => {
    const context = await ownerData.contexts.create('Archive')
    const task = await ownerData.tasks.create({ contextId: context.id, title: 'Archive me' })

    expect((await ownerData.tasks.setArchived(task.id, true)).archivedAt).not.toBeNull()
    expect((await ownerData.tasks.list('open')).map((entry) => entry.id)).not.toContain(task.id)
    expect((await ownerData.tasks.list('archived')).map((entry) => entry.id)).toContain(task.id)

    expect((await ownerData.tasks.setArchived(task.id, false)).archivedAt).toBeNull()
    expect((await ownerData.tasks.list('open')).map((entry) => entry.id)).toContain(task.id)
    expect((await ownerData.tasks.list('archived')).map((entry) => entry.id)).not.toContain(task.id)
  })
})

describe('TV summary against real Supabase (Phase 2c-3a)', () => {
  const secret = 'SECRET-INTEGRATION-NOTE'

  it('shows the TV only what the database allows, in deadline order, with no notes', async () => {
    // Shown on the TV.
    const onTv = await ownerData.contexts.create('On TV')
    await ownerData.contexts.setShowOnTv(onTv.id, true)
    const dated = await ownerData.tasks.create({ contextId: onTv.id, title: 'TV date task' })
    await ownerData.tasks.update(dated.id, { notes: secret, priority: 'low', deadline: { kind: 'date', date: '2030-03-15' } })
    const timed = await ownerData.tasks.create({ contextId: onTv.id, title: 'TV timed task' })
    await ownerData.tasks.update(timed.id, { priority: 'high', deadline: { kind: 'time', at: '2030-03-15T08:00:00.000Z' } })
    await ownerData.tasks.create({ contextId: onTv.id, title: 'TV no deadline' })

    // Left out by the database.
    const hidden = await ownerData.tasks.create({ contextId: onTv.id, title: 'TV hidden' })
    await ownerData.tasks.update(hidden.id, { hideFromTv: true })
    const done = await ownerData.tasks.create({ contextId: onTv.id, title: 'TV done' })
    await ownerData.tasks.setDone(done.id, true)
    const archived = await ownerData.tasks.create({ contextId: onTv.id, title: 'TV archived' })
    await ownerData.tasks.setArchived(archived.id, true)
    const offTv = await ownerData.contexts.create('Not on TV')
    await ownerData.tasks.create({ contextId: offTv.id, title: 'TV private context' })
    const oldContext = await ownerData.contexts.create('Archived on TV')
    await ownerData.contexts.setShowOnTv(oldContext.id, true)
    await ownerData.tasks.create({ contextId: oldContext.id, title: 'TV archived context' })
    await ownerData.contexts.setArchived(oldContext.id, true)

    const summary = await tvData.summary.get()
    expect(typeof summary.generatedAt).toBe('string')
    expect(summary.tasks.map((task) => task.title)).toEqual(['TV timed task', 'TV date task', 'TV no deadline'])
    expect(summary.tasks[0].deadline?.kind).toBe('time')
    expect(summary.tasks[1]).toEqual({ title: 'TV date task', context: 'On TV', priority: 'low', deadline: { kind: 'date', date: '2030-03-15' } })
    expect(summary.tasks[2].deadline).toBeNull()
    expect(JSON.stringify(summary)).not.toContain(secret)

    // The owner, with an authenticator code, gets exactly the same redacted summary.
    expect((await ownerData.summary.get()).tasks).toEqual(summary.tasks)
  })
})

describe('data layer against real Supabase (TV sign-in)', () => {
  it('sees none of the owner\'s contexts or tasks directly', async () => {
    expect(await tvData.contexts.list({ includeArchived: true })).toEqual([])
    expect(await tvData.tasks.list('open')).toEqual([])
    expect(await tvData.tasks.list('archived')).toEqual([])
    expect(await tvData.tasks.completedSince(new Date(0))).toEqual([])
  })

  it('cannot create a context', async () => {
    await expect(tvData.contexts.create('Not allowed')).rejects.toThrow('Nexus refused')
  })
})
