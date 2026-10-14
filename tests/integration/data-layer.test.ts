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
})

describe('data layer against real Supabase (TV sign-in)', () => {
  it('sees none of the owner\'s contexts or tasks directly', async () => {
    expect(await tvData.contexts.list({ includeArchived: true })).toEqual([])
    expect(await tvData.tasks.list('open')).toEqual([])
  })

  it('cannot create a context', async () => {
    await expect(tvData.contexts.create('Not allowed')).rejects.toThrow('Nexus refused')
  })
})
