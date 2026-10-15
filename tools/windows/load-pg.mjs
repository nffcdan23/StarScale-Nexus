// Loads the PostgreSQL client from tools/windows for the Windows-only checks
// (real security checks, integration tests, account set-up). Refuses on any
// other computer.

import { createRequire } from 'node:module'
import { requireWindows } from './windows-only.mjs'

const require = createRequire(import.meta.url)

export function loadPg() {
  requireWindows('The PostgreSQL client')
  try {
    return require('pg')
  } catch {
    throw new Error('The "pg" package is not installed. Run: npm run setup:windows')
  }
}
