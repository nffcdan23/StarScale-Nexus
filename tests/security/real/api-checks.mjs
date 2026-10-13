// Checks that go through Supabase's real sign-in service and Data API, the
// same way the Nexus app will. They cannot be imitated.
//
// STATUS: written, never executed. The web addresses below follow Supabase's
// documented sign-in and Data API routes as understood when this was
// written; confirm them against the current documentation on first use.

import { createHmac, randomUUID } from 'node:crypto'
import { secretNote } from '../lib/fixtures.mjs'

async function call(config, path, { method = 'GET', key = config.publishableKey, token, body } = {}) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    // Some refusals have no body.
  }
  return { status: response.status, data }
}

const refused = (response) => response.status === 401 || response.status === 403

/** A standard six-digit authenticator code for a secret given in base32. */
function authenticatorCode(base32Secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of base32Secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  }
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[digest.length - 1] & 0xf
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

async function createUser(config, label) {
  const email = `nexus-test-${label}-${randomUUID()}@example.test`
  const password = randomUUID() + randomUUID()
  const created = await call(config, '/auth/v1/admin/users', {
    method: 'POST',
    key: config.secretKey,
    body: { email, password, email_confirm: true },
  })
  if (!created.data?.id) throw new Error(`could not create the ${label} test sign-in (status ${created.status})`)
  return { id: created.data.id, email, password }
}

async function signIn(config, user) {
  const response = await call(config, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: user.email, password: user.password },
  })
  if (!response.data?.access_token) throw new Error(`sign-in failed (status ${response.status})`)
  return response.data.access_token
}

/** Enrols an authenticator and returns a session that has passed the second factor. */
async function passSecondFactor(config, token) {
  const factor = await call(config, '/auth/v1/factors', {
    method: 'POST',
    token,
    body: { factor_type: 'totp', friendly_name: 'nexus-test' },
  })
  const challenge = await call(config, `/auth/v1/factors/${factor.data.id}/challenge`, { method: 'POST', token })
  const verified = await call(config, `/auth/v1/factors/${factor.data.id}/verify`, {
    method: 'POST',
    token,
    body: { challenge_id: challenge.data.id, code: authenticatorCode(factor.data.totp.secret) },
  })
  if (!verified.data?.access_token) throw new Error(`authenticator verification failed (status ${verified.status})`)
  return verified.data.access_token
}

export async function runApiChecks(config, db) {
  const results = []
  const check = async (id, run) => {
    try {
      const problem = await run()
      results.push({ id, status: problem ? 'failed' : 'passed', detail: problem ?? '' })
    } catch (error) {
      results.push({ id, status: 'failed', detail: error.message })
    }
  }

  const users = []
  try {
    const owner = await createUser(config, 'owner')
    const tv = await createUser(config, 'tv')
    users.push(owner, tv)

    const contextId = randomUUID()
    await db.query(
      `insert into private.identities (user_id, kind, owner_id) values ($1, 'owner', null), ($2, 'tv', $1)`,
      [owner.id, tv.id],
    )
    await db.query(
      `insert into public.contexts (id, owner_id, name, slug, show_on_tv) values ($1, $2, 'StarScale', 'starscale', true)`,
      [contextId, owner.id],
    )
    await db.query(
      `insert into public.tasks (owner_id, context_id, title, notes, hide_from_tv) values
         ($1, $2, 'Visible task', $3, false), ($1, $2, 'Hidden task', null, true)`,
      [owner.id, contextId, secretNote],
    )

    const tasksPath = '/rest/v1/tasks?select=id,title'
    const newTask = { context_id: contextId, title: 'Added through the Data API' }

    await check('REAL-02', async () => {
      const response = await call(config, tasksPath)
      return refused(response) ? null : `expected a refusal, got status ${response.status}`
    })

    await check('REAL-03', async () => {
      const response = await call(config, '/rest/v1/rpc/tv_summary', { method: 'POST', body: {} })
      return refused(response) || response.status === 404 ? null : `expected a refusal, got status ${response.status}`
    })

    const ownerToken = await signIn(config, owner)

    await check('REAL-04', async () => {
      const read = await call(config, tasksPath, { token: ownerToken })
      if (read.status !== 200 || read.data.length !== 0) return `password alone returned ${JSON.stringify(read.data)}`
      const write = await call(config, '/rest/v1/tasks', { method: 'POST', token: ownerToken, body: newTask })
      return refused(write) ? null : `password alone could add a task (status ${write.status})`
    })

    await check('REAL-05', async () => {
      const strongToken = await passSecondFactor(config, ownerToken)
      const read = await call(config, tasksPath, { token: strongToken })
      if (read.status !== 200 || read.data.length !== 2) return `expected 2 tasks, got status ${read.status}`
      const write = await call(config, '/rest/v1/tasks', { method: 'POST', token: strongToken, body: newTask })
      return write.status === 201 && write.data[0]?.owner_id === owner.id
        ? null
        : `could not add a task as the owner (status ${write.status})`
    })

    const tvToken = await signIn(config, tv)

    await check('REAL-06', async () => {
      const summary = await call(config, '/rest/v1/rpc/tv_summary', { method: 'POST', token: tvToken, body: {} })
      const titles = summary.data?.tasks?.map((task) => task.title).sort()
      if (summary.status !== 200 || !titles?.includes('Visible task') || titles.includes('Hidden task')) {
        return `unexpected summary: ${JSON.stringify(summary.data)}`
      }
      if (JSON.stringify(summary.data).includes(secretNote)) return 'the summary leaked a task note'
      const read = await call(config, tasksPath, { token: tvToken })
      return read.status === 200 && read.data.length === 0 ? null : 'the TV sign-in could read tasks directly'
    })

    await check('REAL-07', async () => {
      const write = await call(config, '/rest/v1/tasks', { method: 'POST', token: tvToken, body: newTask })
      return refused(write) ? null : `the TV sign-in could add a task (status ${write.status})`
    })

    await check('REAL-08', async () => {
      const response = await call(config, '/auth/v1/signup', {
        method: 'POST',
        body: { email: `nexus-test-signup-${randomUUID()}@example.test`, password: randomUUID() },
      })
      return response.status >= 400 ? null : 'a new sign-up was accepted; switch sign-ups off in the local settings'
    })
  } finally {
    // Removing a test sign-in also removes its contexts and tasks.
    for (const user of users) {
      await call(config, `/auth/v1/admin/users/${user.id}`, { method: 'DELETE', key: config.secretKey })
    }
  }

  return results
}
