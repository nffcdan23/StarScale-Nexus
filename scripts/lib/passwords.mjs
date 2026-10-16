// NEXUS-ADMIN-ONLY: passwords for new Nexus sign-ins. Never imported by the app.

import { randomInt } from 'node:crypto'

/** About 124 bits of randomness, in groups that are easy to type on a TV keyboard. */
export function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const groups = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''),
  )
  return groups.join('-')
}
