// NEXUS-ADMIN-ONLY: creates Nexus sign-ins. Never imported by the app; the
// build fails if this marker ever appears in the app files.
//
// Runs only on the Windows PC, only against the local Supabase stack, using
// the same .env.security.local settings as the real security checks.
//
//   npm run account -- owner --email you@example.com
//   npm run account -- tv --email office-tv@example.com --owner-email you@example.com
//   npm run account -- list
//
// Each new sign-in gets a long random password, printed once. It is labelled
// with its role (for choosing screens) and registered in private.identities,
// which is what the database rules actually check.

import { randomInt } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`\nAccount set-up stopped: ${message}\n`)
  process.exit(1)
}

function readSettings() {
  if (process.platform !== 'win32') {
    fail('this runs only on the Windows PC with the local Supabase stack, never on the MacBook.')
  }
  const envFile = join(projectRoot, '.env.security.local')
  if (!existsSync(envFile)) fail('.env.security.local is missing. Copy .env.security.example and fill it in.')
  process.loadEnvFile(envFile)

  const settings = {
    dbUrl: process.env.NEXUS_TEST_DB_URL,
    apiUrl: process.env.NEXUS_TEST_API_URL?.replace(/\/$/, ''),
    secretKey: process.env.NEXUS_TEST_SECRET_KEY,
  }
  const missing = Object.entries(settings).filter(([, value]) => !value).map(([name]) => name)
  if (missing.length > 0) fail(`missing settings in .env.security.local: ${missing.join(', ')}`)

  for (const url of [settings.dbUrl, settings.apiUrl]) {
    const host = new URL(url).hostname
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      fail(`${host} is not this computer. Accounts are created here only on the local Supabase stack.`)
    }
  }
  return settings
}

function readArguments(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]
    if (!name?.startsWith('--') || rest[index + 1] === undefined) fail(`unexpected argument "${name}"`)
    options[name.slice(2)] = rest[index + 1]
  }
  return { command, options }
}

/** About 124 bits of randomness, in groups that are easy to type on a TV keyboard. */
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const groups = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''),
  )
  return groups.join('-')
}

async function adminCall(settings, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${settings.apiUrl}/auth/v1/admin${path}`, {
    method,
    headers: {
      apikey: settings.secretKey,
      Authorization: `Bearer ${settings.secretKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    // Some replies have no body.
  }
  return { ok: response.ok, status: response.status, data }
}

const describe = (reply) =>
  `status ${reply.status}${reply.data?.error_code ? ` (${reply.data.error_code})` : ''}${
    reply.data?.msg ? `: ${reply.data.msg}` : ''
  }`

async function connect(dbUrl) {
  let pg
  try {
    pg = (await import('pg')).default
  } catch {
    fail('the "pg" package is not installed here. Run npm ci on the Windows PC.')
  }
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  return client
}

async function list(db) {
  const { rows } = await db.query(`
    select u.email, i.kind, o.email as owner_email, i.created_at
    from private.identities i
    join auth.users u on u.id = i.user_id
    left join auth.users o on o.id = i.owner_id
    order by i.created_at`)
  if (rows.length === 0) console.log('No Nexus sign-ins are registered yet.')
  for (const row of rows) {
    console.log(`${row.kind.padEnd(5)} ${row.email}${row.owner_email ? ` (shows ${row.owner_email})` : ''}`)
  }
}

async function create(settings, db, role, options) {
  const email = options.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('give a valid --email')

  let ownerId = null
  if (role === 'tv') {
    const ownerEmail = options['owner-email']?.trim().toLowerCase()
    if (!ownerEmail) fail('a TV needs --owner-email: the owner whose summary it shows')
    const { rows } = await db.query(
      `select i.user_id from private.identities i join auth.users u on u.id = i.user_id
       where i.kind = 'owner' and lower(u.email) = $1`,
      [ownerEmail],
    )
    if (rows.length === 0) fail(`${ownerEmail} is not a registered owner. Create the owner first.`)
    ownerId = rows[0].user_id
  }

  const password = generatePassword()
  const created = await adminCall(settings, '/users', {
    method: 'POST',
    body: { email, password, email_confirm: true, app_metadata: { nexus_role: role } },
  })
  if (!created.ok || !created.data?.id) fail(`Supabase did not create the sign-in, ${describe(created)}`)
  const userId = created.data.id

  try {
    await db.query(
      `insert into private.identities (user_id, kind, owner_id, label) values ($1, $2, $3, $4)`,
      [userId, role, ownerId, role === 'tv' ? 'TV' : 'Owner'],
    )
  } catch (error) {
    // Never leave a sign-in that exists but is not registered.
    await adminCall(settings, `/users/${userId}`, { method: 'DELETE' })
    fail(`could not register the sign-in, so it was removed again: ${error.message}`)
  }

  console.log(`\nCreated the ${role === 'tv' ? 'TV' : 'owner'} sign-in ${email}.`)
  console.log(`\n  Password: ${password}\n`)
  console.log('This is the only time the password is shown. Save it in your password manager now.')
  if (role === 'owner') {
    console.log('\nNext, before using this password anywhere else: run the app, sign in, and set up')
    console.log('your authenticator when Nexus asks. Until then, anyone with the password could do it.')
  } else {
    console.log('\nSign in once in the TV browser profile. It goes straight to the TV display and')
    console.log('stays signed in. It can read only the redacted TV summary.')
  }
}

const { command, options } = readArguments(process.argv.slice(2))
if (!['owner', 'tv', 'list'].includes(command)) {
  fail('use one of: owner --email ADDRESS | tv --email ADDRESS --owner-email ADDRESS | list')
}

const settings = readSettings()
const db = await connect(settings.dbUrl)
try {
  if (command === 'list') await list(db)
  else await create(settings, db, command, options)
} finally {
  await db.end()
}
