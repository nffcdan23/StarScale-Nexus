// NEXUS-ADMIN-ONLY: asking the owner for secrets and confirmations in the
// terminal. Never imported by the app.
//
// Secrets are typed (or pasted) into a hidden prompt: nothing is shown on
// screen, nothing is saved, and they are never read from a file, a pipe or
// an environment variable.

import { createInterface } from 'node:readline/promises'
import { newPasswordProblem } from './accounts.mjs'
import { CloudProblem } from './settings.mjs'

/** Asks for a secret without showing it. Enter finishes; Ctrl+C stops. */
export function askHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new CloudProblem('Secrets can only be typed into a terminal window, never piped in.'))
  }
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = (error) => {
      input.removeListener('data', onData)
      input.setRawMode(false)
      input.pause()
      output.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n') return finish()
        if (char === '\u0003') return finish(new CloudProblem('Stopped. Nothing was changed.'))
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else if (char >= ' ') value += char
      }
    }
    output.write(`${question} (typing is hidden): `)
    input.setRawMode(true)
    input.setEncoding('utf8')
    input.on('data', onData)
    input.resume()
  })
}

/** The database password for this project. */
export async function askDatabasePassword(io) {
  const password = await askHidden('Database password', io)
  if (!password) throw new CloudProblem('No database password was typed. Nothing was changed.')
  return password
}

/** A secret key, created in the dashboard for this session and deleted afterwards. */
export async function askSecretKey(io) {
  const key = (await askHidden('Temporary secret key (sb_secret_...)', io)).trim()
  if (key.startsWith('eyJ')) {
    throw new CloudProblem('That is an old-style service_role key. Create a secret key under Project Settings → API Keys instead.')
  }
  if (!key.startsWith('sb_secret_')) throw new CloudProblem('That is not a secret key (they start sb_secret_). Nothing was changed.')
  return key
}

/** A new sign-in password, typed twice, hidden. Nothing is changed if it is unsuitable or the two differ. */
export async function askNewPassword(io) {
  const password = await askHidden('New password', io)
  const problem = newPasswordProblem(password)
  if (problem) throw new CloudProblem(`${problem} Nothing was changed.`)
  const again = await askHidden('Type the new password again', io)
  if (again !== password) throw new CloudProblem('The two passwords did not match. Nothing was changed.')
  return password
}

/**
 * The owner must type the project id to go ahead. Anything else, including
 * pressing Enter, stops. Returns true only on an exact match.
 */
export async function confirmProject(projectRef, { input = process.stdin, output = process.stdout } = {}) {
  const lines = createInterface({ input, output, terminal: false })
  try {
    const answer = await lines.question(`Type the project id (${projectRef}) to go ahead, or press Enter to stop: `)
    return answer.trim() === projectRef
  } finally {
    lines.close()
  }
}
