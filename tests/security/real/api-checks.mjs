// Checks that go through Supabase's real sign-in service and Data API, the
// same way the Nexus app will. They cannot be imitated.
//
// First run on the Windows PC (14 October 2026): routes confirmed working,
// except the authenticator steps, which the local settings had switched off.

import { createHmac, randomUUID } from 'node:crypto'
import { noteDoc, secretNote, secretNoteBody } from '../lib/fixtures.mjs'

export const apiCheckIds = ['REAL-02', 'REAL-03', 'REAL-04', 'REAL-05', 'REAL-06', 'REAL-07', 'REAL-08', 'REAL-09', 'REAL-10']

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
const succeeded = (response) => response.status >= 200 && response.status < 300

/** One line describing a reply, for example "status 422 (mfa_totp_enroll_not_enabled): ...". */
function describe(response) {
  const data = response.data ?? {}
  const code = data.error_code ?? data.code
  const message = data.msg ?? data.message ?? data.error_description ?? data.error
  return `status ${response.status}${code ? ` (${code})` : ''}${message ? `: ${message}` : ''}`
}

/**
 * Stops with a clear message unless the request succeeded and the reply
 * contains the named field. This is what turns an unexpected reply into a
 * readable failure instead of a crash.
 */
function requireField(response, step, read) {
  const value = succeeded(response) ? read(response.data ?? {}) : undefined
  if (value === undefined || value === null || value === '') {
    throw new Error(`${step} failed, ${describe(response)}`)
  }
  return value
}

/** A standard six-digit authenticator code for a secret given in base32. */
export function authenticatorCode(base32Secret) {
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
  const id = requireField(created, `Creating the ${label} test sign-in`, (data) => data.id)
  return { id, email, password }
}

async function deleteUser(config, id) {
  await call(config, `/auth/v1/admin/users/${id}`, { method: 'DELETE', key: config.secretKey })
}

async function signIn(config, user, label) {
  const response = await call(config, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: user.email, password: user.password },
  })
  return requireField(response, `Password sign-in for the ${label}`, (data) => data.access_token)
}

/** Enrols an authenticator and returns a session that has passed the second factor. */
async function passSecondFactor(config, token) {
  const factor = await call(config, '/auth/v1/factors', {
    method: 'POST',
    token,
    body: { factor_type: 'totp', friendly_name: 'nexus-test' },
  })
  const factorId = requireField(factor, 'Setting up an authenticator', (data) => data.id)
  const secret = requireField(factor, 'Setting up an authenticator', (data) => data.totp?.secret)

  const challenge = await call(config, `/auth/v1/factors/${factorId}/challenge`, { method: 'POST', token })
  const challengeId = requireField(challenge, 'Requesting an authenticator challenge', (data) => data.id)

  const verified = await call(config, `/auth/v1/factors/${factorId}/verify`, {
    method: 'POST',
    token,
    body: { challenge_id: challengeId, code: authenticatorCode(secret) },
  })
  return requireField(verified, 'Verifying the authenticator code', (data) => data.access_token)
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
    let owner, tv, contextId
    try {
      owner = await createUser(config, 'owner')
      users.push(owner)
      tv = await createUser(config, 'tv')
      users.push(tv)

      contextId = randomUUID()
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
      await db.query(`insert into public.notes (owner_id, title, content) values ($1, 'Private note', $2::jsonb)`, [
        owner.id,
        noteDoc(`Private thoughts ${secretNoteBody}`),
      ])
    } catch (error) {
      // Without the test sign-ins none of these checks can run. Record them
      // as not executed, so the report never shows an older result as current.
      return apiCheckIds.map((id) => ({ id, status: 'not-executed', detail: `setup failed: ${error.message}` }))
    }

    // The owner signs in with a password and an authenticator code once; the
    // checks that need that session share it.
    let strongToken = null
    const ownerWithCode = async () => {
      if (!strongToken) strongToken = await passSecondFactor(config, await signIn(config, owner, 'owner'))
      return strongToken
    }

    const tasksPath = '/rest/v1/tasks?select=id,title'
    const newTask = { context_id: contextId, title: 'Added through the Data API' }

    await check('REAL-02', async () => {
      const response = await call(config, tasksPath)
      return refused(response) ? null : `expected a refusal, got ${describe(response)}`
    })

    await check('REAL-03', async () => {
      const response = await call(config, '/rest/v1/rpc/tv_summary', { method: 'POST', body: {} })
      return refused(response) || response.status === 404 ? null : `expected a refusal, got ${describe(response)}`
    })

    // Signing in is part of each check below, so a sign-in failure is
    // reported against the checks that needed it.
    await check('REAL-04', async () => {
      const ownerToken = await signIn(config, owner, 'owner')
      const read = await call(config, tasksPath, { token: ownerToken })
      if (read.status !== 200 || !Array.isArray(read.data) || read.data.length !== 0) {
        return `password alone should see no tasks, got ${describe(read)} ${JSON.stringify(read.data)}`
      }
      const write = await call(config, '/rest/v1/tasks', { method: 'POST', token: ownerToken, body: newTask })
      return refused(write) ? null : `password alone could add a task, ${describe(write)}`
    })

    await check('REAL-05', async () => {
      const strongToken = await ownerWithCode()
      const read = await call(config, tasksPath, { token: strongToken })
      if (read.status !== 200 || !Array.isArray(read.data) || read.data.length !== 2) {
        return `expected 2 tasks after the authenticator code, got ${describe(read)} ${JSON.stringify(read.data)}`
      }
      const write = await call(config, '/rest/v1/tasks', { method: 'POST', token: strongToken, body: newTask })
      return write.status === 201 && write.data?.[0]?.owner_id === owner.id
        ? null
        : `could not add a task as the owner, ${describe(write)}`
    })

    await check('REAL-06', async () => {
      const tvToken = await signIn(config, tv, 'TV')
      const summary = await call(config, '/rest/v1/rpc/tv_summary', { method: 'POST', token: tvToken, body: {} })
      const titles = summary.data?.tasks?.map((task) => task.title).sort()
      if (summary.status !== 200 || !titles?.includes('Visible task') || titles.includes('Hidden task')) {
        return `unexpected summary, ${describe(summary)} ${JSON.stringify(summary.data)}`
      }
      if (JSON.stringify(summary.data).includes(secretNote)) return 'the summary leaked a task note'
      const fields = summary.data.tasks.map((task) => Object.keys(task).sort().join(','))
      if (fields.some((entry) => entry !== 'context,due_at,due_on,priority,title')) {
        return `the summary returned unexpected fields: ${JSON.stringify(fields)}`
      }
      const read = await call(config, tasksPath, { token: tvToken })
      return read.status === 200 && Array.isArray(read.data) && read.data.length === 0
        ? null
        : `the TV sign-in could read tasks directly, ${describe(read)}`
    })

    await check('REAL-07', async () => {
      const tvToken = await signIn(config, tv, 'TV')
      const write = await call(config, '/rest/v1/tasks', { method: 'POST', token: tvToken, body: newTask })
      return refused(write) ? null : `the TV sign-in could add a task, ${describe(write)}`
    })

    await check('REAL-08', async () => {
      const response = await call(config, '/auth/v1/signup', {
        method: 'POST',
        body: { email: `nexus-test-signup-${randomUUID()}@example.test`, password: randomUUID() + randomUUID() },
      })
      if (response.status >= 400) return null
      // The sign-up got through. Remove the account it created, then fail.
      const strayId = response.data?.user?.id ?? response.data?.id
      if (strayId) await deleteUser(config, strayId)
      return `a new sign-up was accepted (${describe(response)}); switch sign-ups off in supabase/config.toml and restart the stack`
    })

    await check('REAL-09', async () => {
      const token = await ownerWithCode()
      const created = await call(config, '/rest/v1/notes', {
        method: 'POST',
        token,
        body: { title: 'Real note', content: JSON.parse(noteDoc('Quarterly investor review')) },
      })
      const note = created.data?.[0]
      if (created.status !== 201 || !note) return `could not add a note, ${describe(created)}`
      if (note.owner_id !== owner.id || note.context_id !== null || note.revision !== 1) {
        return `the new note has the wrong owner, context or revision: ${JSON.stringify(note)}`
      }
      if (note.content_text !== 'Quarterly investor review') return `searchable text was not derived: ${JSON.stringify(note.content_text)}`

      const found = await call(config, '/rest/v1/rpc/search_notes', { method: 'POST', token, body: { search_text: 'quarter' } })
      if (found.status !== 200 || !found.data?.some((row) => row.id === note.id)) {
        return `search did not find the note, ${describe(found)}`
      }

      const forged = await call(config, `/rest/v1/notes?id=eq.${note.id}`, {
        method: 'PATCH',
        token,
        body: { content_text: 'Forged text' },
      })
      return refused(forged) ? null : `the owner could write the searchable text directly, ${describe(forged)}`
    })

    await check('REAL-10', async () => {
      const tvToken = await signIn(config, tv, 'TV')
      const read = await call(config, '/rest/v1/notes?select=id,title', { token: tvToken })
      if (read.status !== 200 || !Array.isArray(read.data) || read.data.length !== 0) {
        return `the TV sign-in could read notes, ${describe(read)} ${JSON.stringify(read.data)}`
      }
      const search = await call(config, '/rest/v1/rpc/search_notes', {
        method: 'POST',
        token: tvToken,
        body: { search_text: secretNoteBody },
      })
      if (search.status !== 200 || !Array.isArray(search.data) || search.data.length !== 0) {
        return `the TV sign-in could search notes, ${describe(search)} ${JSON.stringify(search.data)}`
      }
      const write = await call(config, '/rest/v1/notes', { method: 'POST', token: tvToken, body: { title: 'From the TV' } })
      if (!refused(write)) return `the TV sign-in could add a note, ${describe(write)}`
      const anonymous = await call(config, '/rest/v1/rpc/search_notes', { method: 'POST', body: { search_text: 'private' } })
      return refused(anonymous) || anonymous.status === 404
        ? null
        : `a visitor with only the public key could search notes, ${describe(anonymous)}`
    })
  } finally {
    // Removing a test sign-in also removes its contexts and tasks.
    for (const user of users) await deleteUser(config, user.id)
  }

  return results
}
